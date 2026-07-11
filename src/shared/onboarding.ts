/**
 * 온보딩 단계 전이 규칙 — 순수 모듈(Electron·React 무의존).
 *
 * 최초 실행 온보딩은 7단계를 순서대로 진행한다. 단계 목록·전진/후퇴 판정·완료
 * 판정을 여기 모으고, 렌더러(화면)와 본체(완료 플래그 저장)는 얇은 셸로 둔다.
 * 온보딩은 녹화 상태 머신(RecordingState)과 직교 — 여기에도 녹화 상태는 없다.
 *
 * 이 슬라이스에서 각 단계 콘텐츠는 제목 스텁이고, 권한 단계도 항상 전진 가능하다
 * (실제 권한 게이팅은 후속 슬라이스 #47).
 */

/** 온보딩 단계 식별자. 배열 순서가 곧 진행 순서다. */
export type OnboardingStepId =
  | 'permissions'
  | 'overview'
  | 'feature-recording'
  | 'feature-editing'
  | 'feature-export'
  | 'shortcuts'
  | 'faq'

export interface OnboardingStep {
  id: OnboardingStepId
  /** 카드에 표시할 단계 제목. 이 슬라이스에서 콘텐츠는 이 제목뿐이다. */
  title: string
}

/**
 * 7단계 순서: 권한 → 기능 개요 → 기능 상세×3(녹화·자동 효과 / 경량 편집 / 익스포트)
 * → 단축키 → FAQ (PRD #45). 제목은 CONTEXT.md 용어를 그대로 쓴다.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'permissions', title: '화면 녹화·손쉬운 사용 권한' },
  { id: 'overview', title: 'Recap이 하는 일' },
  { id: 'feature-recording', title: '녹화와 자동 효과' },
  { id: 'feature-editing', title: '경량 편집' },
  { id: 'feature-export', title: '익스포트' },
  { id: 'shortcuts', title: '전역 단축키 ⌥⌘R' },
  { id: 'faq', title: '자주 묻는 질문' }
]

/** 온보딩이 요구하는 권한 종류 — 화면 녹화·손쉬운 사용 둘 다 필수(마이크·카메라 없음). */
export type PermissionKind = 'screen' | 'accessibility'

/** 두 권한의 granted 여부. 렌더러 폴링이 IPC로 받아 판정에 넘긴다. */
export interface PermissionStatus {
  screen: boolean
  accessibility: boolean
}

/** core 권한 충족 — 화면 녹화·손쉬운 사용이 모두 granted여야 참. */
export function arePermissionsSatisfied(status: PermissionStatus): boolean {
  return status.screen && status.accessibility
}

/**
 * 현재 단계에서 '다음'으로 전진할 수 있는지의 게이트. 권한 단계에서는 두 권한이
 * 모두 granted여야 하고, 그 외 단계는 언제나 전진 가능하다. (전이 계산은 advance,
 * 전진 허용 여부는 여기서 판정한다.)
 */
export function canAdvance(index: number, permissions: PermissionStatus): boolean {
  if (ONBOARDING_STEPS[index]?.id === 'permissions') {
    return arePermissionsSatisfied(permissions)
  }
  return true
}

/** 첫 단계인지 — 첫 단계에서는 후퇴할 수 없다. */
export function isFirstStep(index: number): boolean {
  return index <= 0
}

/** 마지막 단계인지 — 마지막 단계의 '다음' 액션은 온보딩 완료다. */
export function isLastStep(index: number): boolean {
  return index >= ONBOARDING_STEPS.length - 1
}

/** 후퇴 가능 여부. 첫 단계에서는 불가. */
export function canGoBack(index: number): boolean {
  return !isFirstStep(index)
}

/** '다음' 액션의 결과 — 다음 단계로 이동하거나 온보딩을 완료한다. */
export type AdvanceResult =
  | { kind: 'step'; index: number }
  | { kind: 'complete' }

/**
 * 현재 단계에서 '다음'을 눌렀을 때의 전이. 마지막 단계면 완료, 아니면 다음 단계.
 * 이 슬라이스에서 권한 단계도 항상 전진 가능하다(권한 게이팅은 #47).
 */
export function advance(index: number): AdvanceResult {
  if (isLastStep(index)) return { kind: 'complete' }
  return { kind: 'step', index: index + 1 }
}

/** '이전' 액션의 결과 단계. 첫 단계면 그대로 머문다. */
export function goBack(index: number): number {
  return canGoBack(index) ? index - 1 : index
}
