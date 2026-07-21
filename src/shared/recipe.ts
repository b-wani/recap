/**
 * 렌더 레시피 파이프라인 — 자동 효과의 순수 코어.
 *
 * 두 단계의 순수 TypeScript 함수 체인이다 (Electron·Canvas·WebCodecs 무의존):
 *
 *  1. 자동 효과 유도  `deriveRecipe(이벤트 트랙) → 렌더 레시피`
 *     클릭 이벤트로부터 줌 구간 목록(팬 키프레임 포함)을 생성한다.
 *  2. 합성 파라미터 샘플링   `sampleComposition(렌더 레시피, 시각 t) → 프레임 합성`
 *     특정 시각의 카메라 변환(줌+팬)·스무딩된 커서·클릭 하이라이트에 더해
 *     배경/패딩·배지까지 합쳐, 미리보기와 익스포트가 공유하는 단일 출력을 낸다.
 *     (`sampleFrame`은 카메라·커서·클릭만, `sampleRecipe`는 카메라 변환만 떼어낸 하위 함수다.)
 *
 * 미리보기·익스포트 렌더링(Canvas)은 sampleComposition의 출력을 그대로 그리기만 하는 얇은 층이다.
 * 효과 계산(줌 이징·팬·커서 스무딩·클릭 하이라이트·배경/패딩·배지)은 전부 이 모듈 안에 있다.
 * 튜닝 수치(배율·이징·타이밍·스무딩 강도·배경/패딩 기본값)는 여기 상수로 모은다.
 */

import type { CaptureTarget, CursorKind, EventTrack, KeySample, MouseSample } from './event-track'

/** 원본 프레임 크기(px). 카메라 클램핑의 기준이 된다. */
export interface FrameSize {
  width: number
  height: number
}

/** 타임라인상 한 클릭 지점의 카메라 중심(원본 px). 줌 유지 중 팬 보간의 키프레임. */
export interface PanKeyframe {
  t: number
  x: number
  y: number
}

/**
 * 줌 구간 — 타임라인상 특정 시간 범위에 적용되는 확대 효과 단위.
 * 네 지점으로 확대의 생애를 표현한다: 줌인 시작 → 완전 줌인 → 줌아웃 시작 → 완전 줌아웃.
 */
export interface ZoomSegment {
  /** 줌인이 시작되는 시각 (ms). 첫 클릭에서 스프링 램프 길이(ZOOM_RAMP_MS)만큼 전. */
  startMs: number
  /** 완전 줌인에 도달하는 시각 (ms). 첫 클릭 시각. */
  fullInAtMs: number
  /** 줌아웃이 시작되는 시각 (ms). 마지막 활동 + holdAfterMs. */
  holdEndMs: number
  /** 완전 줌아웃이 끝나는 시각 (ms). */
  endMs: number
  /**
   * 이 구간의 확대 배율. 유도 시 전역 `zoomScale`로 채워지며, 에디터에서 구간마다
   * 달리 조절할 수 있다(1.5/2.0/2.5). 샘플링은 전역이 아닌 이 값으로 램프를 계산한다.
   */
  scale: number
  /** 구간 내 클릭들의 카메라 중심 키프레임 (시간순). 유지 중 이 사이를 팬한다. */
  keyframes: PanKeyframe[]
}

/** 커서 위치 키프레임(원본 px) — 스무딩의 입력이 되는 원본 이벤트 좌표. */
export interface CursorKeyframe {
  t: number
  x: number
  y: number
  cursor: CursorKind
}

/** 클릭(down) 지점 — 클릭 하이라이트의 입력. */
export interface ClickMark {
  t: number
  x: number
  y: number
}

/**
 * 커서 트랙 — 커서 스무딩·클릭 하이라이트의 입력. 이벤트 트랙에서 유도되어 레시피에 담긴다.
 * (원본 이벤트를 그대로 두어, 스무딩 강도는 샘플링 시점에 조절할 수 있게 한다.)
 */
export interface CursorTrack {
  /** 시간순 커서 위치 키프레임 (move·down·up 전부). */
  keyframes: CursorKeyframe[]
  /** 시간순 클릭 지점. */
  clicks: ClickMark[]
  /** 커서 그리기 크기 배율 (1 = 기본). 사이드바 연속 슬라이더로 0.5~2.0x 조절한다. */
  size: number
  /**
   * 스무딩 커널의 표준편차(ms). 사이드바에서 끔/약/강으로 조절한다. 0이면 스무딩하지
   * 않고 가장 가까운 원본 이벤트 위치를 그대로 쓴다. 클수록 흔들림이 더 감쇠된다.
   */
  smoothingMs: number
  /** 커서 완전 숨김 (#153). true면 커서를 아예 그리지 않는다. 기본 false. */
  hidden: boolean
  /**
   * 유휴 시 자동 숨김 (#150). true면 커서가 멈춰 있을 때 페이드아웃하고, 다시 움직이면
   * 페이드인한다. 임계·페이드 값은 내부 고정 상수(CURSOR_DEFAULTS). 기본 false.
   */
  hideWhenIdle: boolean
  /**
   * 루프 초기위치 복귀 (#150). true면 출력 마지막 loopReturnMs 동안 커서를 시작(출력 t=0)
   * 좌표로 보간해, 루프 GIF의 이음새를 매끈하게 한다. 기본 true.
   */
  loopReturn: boolean
}

/**
 * 클립 — 최종 영상으로 남기는 원본의 한 조각. `[sourceStartMs, sourceEndMs)` source 구간과
 * 재생 속도 배율(speed)을 가진다. 클립들은 source 오름차순·비겹침으로 늘어서 클립 시퀀스를
 * 이루며, 그 사이 간극이 컷(제거된 구간)이다. 출력 타임라인은 이 클립들을 이어 붙인 것이다.
 * 트림(앞뒤 잘라내기)은 양끝 클립의 경계로 표현된다.
 */
export interface Clip {
  /** 안정적 식별자(UI 선택·편집 대상). split이 index를 밀어내도 클립을 추적한다. */
  id: string
  /** 클립이 남기는 source 구간의 시작(ms). */
  sourceStartMs: number
  /** 클립이 남기는 source 구간의 끝(ms). */
  sourceEndMs: number
  /** 재생 배율(1 = 원속). 2면 이 구간을 2배 빠르게 재생(출력 길이 절반). */
  speed: number
}

/** 배경 채우기 종류 — 단색 또는 그라디언트. 이미지/월페이퍼는 범위 밖. */
export type BackgroundKind = 'color' | 'gradient'

/** 선형 그라디언트 채우기 — 영상 콘텐츠(배경)의 데이터다. UI 크롬 색이 아니다. */
export interface GradientFill {
  /** 그라디언트 각도(deg). 0 = 위→아래, 90 = 왼→오른쪽. */
  angle: number
  /** 색 정지점(CSS color) — 시작색·끝색 순서. */
  stops: [string, string]
}

/**
 * 배경/패딩 스타일 — 첨부했을 때 보기 좋도록 원본 프레임 둘레에 입히는 여백·배경과,
 * 콘텐츠 영역의 라운딩·드롭 섀도. 경량 편집으로 조절하며, 미리보기와 익스포트에 동일하게
 * 반영된다.
 */
export interface BackgroundStyle {
  /** 배경 채우기 종류. */
  type: BackgroundKind
  /** 단색 채우기 색 (type='color'). type='gradient'여도 마지막 선택을 보존한다. */
  color: string
  /** 그라디언트 채우기 (type='gradient'). type='color'여도 마지막 선택을 보존한다. */
  gradient: GradientFill
  /** 패딩 두께 — 프레임 짧은 변 대비 비율 [0, 0.4]. 0이면 여백 없음. */
  padding: number
  /**
   * 콘텐츠 영역 모서리 라운딩(논리 px). 0이면 각진 모서리. 프레임 해상도에 비례해
   * 스케일되므로(compose) Retina·저해상도에서 같은 인상을 준다.
   */
  cornerRadius: number
  /** 콘텐츠 영역 드롭 섀도 강도 [0, 1]. 0이면 섀도 없음. */
  shadow: number
}

/**
 * 키스트로크 트랙 + 오버레이 표시 설정 — 이벤트 트랙의 키 로그에서 유도되어 레시피에 담긴다.
 * 오버레이 계산(활성 창·페이드)은 샘플링 시점에 하므로, 여기엔 원본 키와 표시 토글만 둔다.
 */
export interface KeystrokeTrack {
  /** 시간순 키 입력 (단축키·특수키만). */
  keys: KeySample[]
  /** 오버레이 표시 여부. 배지처럼 레시피에 저장되어 미리보기·익스포트에 반영된다. */
  overlayVisible: boolean
}

/** 뷰포트 크기 배지 설정 — 녹화된 화면 크기를 최종 영상 구석에 표시한다. */
export interface BadgeConfig {
  /** 배지 표시 여부. 렌더 레시피에 저장되어 미리보기·익스포트에 반영된다. */
  visible: boolean
  /**
   * 브랜치/커밋 등 맥락 문자열. 에디터에서 자유 입력하며 형식 제약이 없다(예:
   * `feat/v2-overlay @ 61e6fd6`). 빈 문자열이면 맥락 배지를 그리지 않는다. git 자동
   * 읽기·외부 연동 없이 수동 입력만 담는다.
   */
  contextLabel: string
}

/**
 * 렌더 레시피 — 녹화를 최종 영상으로 합성하는 파라미터.
 * 자동 줌 + 팬 + 커서 + 클립 시퀀스 + 배경/패딩·배지를 다룬다.
 */
export interface RenderRecipe {
  source: FrameSize
  /**
   * 논리 뷰포트 크기(포인트) — 배지가 표시하는 "녹화된 화면 크기"(예: 1440×900).
   * source는 캡처 픽셀(Retina 2x)이라 배지 라벨로는 부적절하다. 대상 정보 없이 유도한
   * 레시피(테스트 픽스처)나 v1 저장본에는 없으며, 그 경우 배지는 source로 폴백한다.
   */
  viewport?: FrameSize
  /** 전역 줌 배율 (1 = 확대 없음). */
  zoomScale: number
  durationMs: number
  zoomSegments: ZoomSegment[]
  /** 커서 스무딩·클릭 하이라이트의 입력. */
  cursor: CursorTrack
  /**
   * 클립 시퀀스 — source 오름차순·비겹침으로 늘어선 클립들. 출력 타임라인은 이들을 이어
   * 붙인 것이다. 신규 유도 레시피는 전체를 덮는 클립 1개를 가지며, 앞뒤 트림은 양끝 클립
   * 경계로 표현된다. output↔source 매핑(outputDurationMs·sourceAtOutput)의 입력이다.
   */
  clips: Clip[]
  /** 배경/패딩 스타일. */
  background: BackgroundStyle
  /** 뷰포트 크기 배지 설정. */
  badge: BadgeConfig
  /** 키 입력 오버레이 — 키 트랙과 표시 토글. */
  keystrokes: KeystrokeTrack
}

/** 시각 t에서의 카메라 상태 — 미리보기 층이 그대로 그린다. */
export interface CameraTransform {
  /** 확대 배율 (1 = 원본 그대로). */
  scale: number
  /** 카메라가 화면 중앙에 두는 원본 좌표(px). */
  x: number
  y: number
}

/** 시각 t의 스무딩된 커서 상태(원본 px) — 미리보기 층이 그대로 그린다. */
export interface CursorSample {
  /** 스무딩된 위치(원본 px). 원본 이벤트의 흔들림이 감쇠되어 있다. */
  x: number
  y: number
  /** 시각 t의 커서 모양(스무딩 대상 아님 — 가장 최근 이벤트의 모양). */
  cursor: CursorKind
  /** 커서 그리기 크기 배율 (레시피의 cursor.size를 그대로 옮긴다). */
  size: number
  /** 커서 불투명도 0→1 (유휴 자동 숨김 페이드). 1 = 완전 불투명. 그리기 층이 globalAlpha로 쓴다. */
  opacity: number
}

/** 시각 t의 활성 클릭 하이라이트 — 미리보기 층이 리플/눌림으로 그린다. */
export interface ClickHighlight {
  /** 클릭 위치(원본 px). */
  x: number
  y: number
  /** 하이라이트 애니메이션 진행도 0→1 (0 = 클릭 순간). */
  progress: number
}

/**
 * 프레임 샘플 — 시각 t에서 미리보기 층이 그려야 할 카메라·커서·클릭 파라미터.
 * 카메라 변환 + 스무딩된 커서 + (있다면) 클릭 하이라이트.
 */
export interface FrameSample {
  camera: CameraTransform
  /** 커서 이벤트가 없으면 null. */
  cursor: CursorSample | null
  /** 활성 클릭 하이라이트가 없으면 null. */
  click: ClickHighlight | null
}

/** 키 오버레이 샘플링 결과 — 시각 t에 표시할 조합 문자열과 페이드 진행도. */
export interface KeyOverlayState {
  /** 표시할 조합 문자열 (예: "⌘S"). */
  combo: string
  /** 페이드 진행도 0→1 (0 = 방금 눌림, 1 = 사라지기 직전). 그리기 층이 불투명도로 환산. */
  fade: number
}

/** 배지 샘플링 결과 — 표시 여부와 표시할 문자열(라벨). */
export interface BadgeState {
  visible: boolean
  /** 뷰포트 크기 라벨 (예: "1440×900"). 녹화된 화면 크기에서 유도. */
  label: string
  /** 사용자 입력 맥락 문자열(브랜치/커밋 등). 빈 문자열이면 맥락 배지를 그리지 않는다. */
  contextLabel: string
}

/**
 * 시각 t의 합성 파라미터 전체 — 미리보기와 익스포트가 공유하는 단일 샘플링 출력.
 * 카메라·커서·클릭(프레임 샘플)에 더해 배경/패딩·배지를 함께 담아, 두 층이 동일한 프레임을 그린다.
 */
export interface FrameComposition {
  camera: CameraTransform
  /**
   * 전환 구간(줌인/아웃·팬) 모션 블러용 서브프레임 카메라 목록 — 노출 창(셔터) 동안의
   * 카메라 궤적을 균등 표본한 것. 그리기 층이 이 카메라들로 뷰를 겹쳐 누적 평균하면 방향성
   * (줌은 방사형) 블러가 된다. 정지(hold) 구간·블러 미요청(fps 미지정) 시 없음(undefined) →
   * 현재 카메라로 한 번만 그린다.
   */
  motionBlur?: CameraTransform[]
  /** 커서 이벤트가 없으면 null. */
  cursor: CursorSample | null
  /** 활성 클릭 하이라이트가 없으면 null. */
  click: ClickHighlight | null
  background: BackgroundStyle
  badge: BadgeState
  /** 시각 t에 표시할 키 오버레이. 활성 창 밖이거나 표시 off면 null. */
  keyOverlay: KeyOverlayState | null
}

export interface DeriveConfig {
  /** 원본 프레임 크기(px). 미리보기는 로드된 영상 크기를 넣는다. */
  source: FrameSize
  /** 전역 줌 배율. 미지정 시 기본값(2.0x). */
  zoomScale?: number
}

/**
 * 자동 줌 튜닝 수치 (SPEC "자동 줌 규칙"). 규칙만 테스트로 고정하고 값은 실험으로 정한다.
 */
export const ZOOM_DEFAULTS = {
  /** 기본 배율 (SPEC 6: 1.5/2.0/2.5, 기본 2.0). */
  scale: 2.0,
  /** 선택 가능한 이산 배율 (전역·구간 공통). setZoomSegmentScale이 이 중 가장 가까운 값으로 스냅한다. */
  scales: [1.5, 2.0, 2.5] as readonly number[],
  /** 마지막 활동 holdAfterMs 후 줌아웃 시작 (SPEC 5: 2초 후). */
  holdAfterMs: 2000,
  /** 클릭 간격이 이 이내면 한 줌 구간으로 병합 (SPEC 4: 3초 이내 줌 유지). */
  mergeGapMs: 3000
} as const

/**
 * 클립 속도 튜닝 수치 (결정 #144 §4 — 클립 speed 편집). 규칙만 테스트로 고정하고 값은
 * 실험으로 정한다(ZOOM_DEFAULTS.scales 선례). setClipSpeed가 이 중 가장 가까운 값으로 스냅한다.
 */
export const SPEED_DEFAULTS = {
  /** 기본 속도(1 = 원속). */
  speed: 1,
  /** 선택 가능한 이산 배속. */
  speeds: [0.5, 1, 1.5, 2] as readonly number[]
} as const

/**
 * 줌 램프 이징 스프링 (결정 #142 — Screen Studio "Slow" 프리셋).
 * 감쇠비 ζ = friction / (2·√(tension·mass)) = 26 / (2·√120) ≈ 1.19 → 과감쇠.
 * 오버슈트 없이 "안착하듯" 멈추는 감쇠를 재현한다 — 대칭 smoothstep 이징을 대체한다.
 */
export const ZOOM_SPRING = { tension: 120, friction: 26, mass: 1 } as const

/** 스프링 안착 판정 임계 — 목표(1)와의 거리·속도가 모두 이 값 미만이면 정지로 본다. */
const SPRING_REST = 0.001
/** 적분 스텝(ms). 1ms 고정 스텝 준-암시적 오일러라 난수·상태 없이 결정론적이다. */
const SPRING_STEP_MS = 1

/**
 * 스프링 궤적을 목표 1로 적분한다(x0=0, v0=0). 준-암시적 오일러 고정 스텝 —
 * 난수·상태 없는 순수 계산이라 결정론적이다. 안착(목표와의 거리·속도 < SPRING_REST)에서
 * 멈추고, 마지막 표본을 정확히 1로 스냅해 램프 경계에서 배율이 목표에 정확히 닿게 한다.
 */
function integrateZoomSpring(): number[] {
  const { tension, friction, mass } = ZOOM_SPRING
  const dt = SPRING_STEP_MS / 1000
  let x = 0
  let v = 0
  const trajectory = [0]
  // 발산·미안착 방어용 상한(10s). 과감쇠라 실제로는 훨씬 일찍 멈춘다.
  const maxSteps = Math.ceil(10000 / SPRING_STEP_MS)
  for (let i = 0; i < maxSteps; i++) {
    const a = (-tension * (x - 1) - friction * v) / mass
    v += a * dt
    x += v * dt
    trajectory.push(x)
    if (Math.abs(1 - x) < SPRING_REST && Math.abs(v) < SPRING_REST) break
  }
  trajectory[trajectory.length - 1] = 1
  return trajectory
}

const SPRING_TRAJECTORY = integrateZoomSpring()

/**
 * 스프링이 안착하기까지 걸리는 램프 길이(ms). 고정 rampIn/Out(각 500ms)를 대체한다 —
 * 이제 램프 길이는 스프링이 멈추는 데 걸리는 시간으로 정해진다(결정 #142). 과감쇠라
 * 초반에 대부분 도달(≈0.5s에 ~93%)하고 꼬리만 느리게 붙어, 체감 줌인은 ≈0.5s로 느껴진다.
 */
export const ZOOM_RAMP_MS = (SPRING_TRAJECTORY.length - 1) * SPRING_STEP_MS

/**
 * 스프링 이징 — 정규화 진행도 p∈[0,1]을 과감쇠 스프링의 안착 곡선(0→1)으로 매핑한다.
 * 미리 적분한 궤적을 선형 보간으로 읽는다. p=0→0, p=1→1(정확), 단조 증가·오버슈트 없음.
 * 기존 smoothstep ease(p)의 드롭인 대체 — 램프 창을 스프링 안착 곡선으로 채운다.
 */
export function springEase(p: number): number {
  const c = clamp(p, 0, 1)
  const idx = c * (SPRING_TRAJECTORY.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return SPRING_TRAJECTORY[lo]
  return SPRING_TRAJECTORY[lo] + (SPRING_TRAJECTORY[hi] - SPRING_TRAJECTORY[lo]) * (idx - lo)
}

/**
 * 모션 블러 튜닝 수치 (결정 #142 — 셔터각 ≈2×). 전환 구간의 프레임 간 카메라 이동을
 * 노출 창(셔터) 동안의 서브프레임 카메라 궤적으로 표본해 그리기 층에서 누적 평균한다 —
 * 줌 궤적이면 방사형, 팬 궤적이면 방향성 블러가 궤적에서 자연히 나온다. 정지(hold) 구간은
 * 궤적이 한 점이라 이동 0 → 블러 0.
 */
export const MOTION_BLUR_DEFAULTS = {
  /**
   * 셔터각 배수 — 노출 창 길이 = shutter × 프레임 간격(ms). 1.0이 셔터각 360°(한 프레임
   * 노출)에 해당하고, 기준선 2.0은 그 2배 노출(≈2× 셔터각)로 실물과 유사한 스미어를 만든다.
   */
  shutter: 2,
  /** 서브프레임 간 목표 이동량(원본 px). 노출 창 이동량이 클수록 서브프레임을 더 촘촘히 쓴다. */
  stepPx: 2,
  /** 서브프레임 수 상한 — 성능을 위해 가장 빠른 전환에서도 이 이상 그리지 않는다. */
  maxSubframes: 24,
  /** 노출 창 최대 이동량이 이 값(원본 px) 미만이면 블러 없음(정지·서브픽셀 이동). */
  minPx: 0.5,
  /**
   * 미리보기의 명목 fps — 미리보기는 rAF로 그려 고정 fps가 없으므로, 이 값으로 노출 창을
   * 잡아 export(주로 Dooray GIF)와 비슷한 블러 인상을 보여 준다(정량 일치가 아닌 근사).
   */
  previewFps: 30
} as const

/**
 * 커서 튜닝 수치 (SPEC "커서 렌더링"). 규칙만 테스트로 고정하고 값은 실험으로 정한다.
 */
export const CURSOR_DEFAULTS = {
  /** 커서 크기 배율 기본값 (1 = 원본). 슬라이더 Reset도 이 값으로 돌린다. */
  size: 1,
  /** 크기 슬라이더 범위·간격 (#150: 0.5~2.0x, step 0.1x). */
  sizeMin: 0.5,
  sizeMax: 2,
  sizeStep: 0.1,
  /** 커서 완전 숨김 기본값 (#153, OFF). */
  hidden: false,
  /** 유휴 자동 숨김 기본값 (#150, OFF). */
  hideWhenIdle: false,
  /** 루프 초기위치 복귀 기본값 (#150, ON — recap 차별화 축=루프 GIF). */
  loopReturn: true,
  /** 유휴 판정 임계(ms) — 이 시간 이상 정지하면 페이드아웃을 시작한다. */
  idleHideMs: 1500,
  /** 정지 판정 이동량(원본 px) — 마지막 이동 지점에서 이보다 덜 움직이면 정지로 본다. */
  idleMovePx: 2,
  /** 유휴 페이드아웃 길이(ms) — ease-out으로 커서가 사라진다. */
  idleFadeOutMs: 400,
  /** 유휴 페이드인 길이(ms) — 다시 움직이면 빠르게 나타난다(반응성). */
  idleFadeInMs: 150,
  /** 루프 복귀 창(ms) — 출력 마지막 이 시간 동안 시작 좌표로 보간한다. */
  loopReturnMs: 800,
  /**
   * 스무딩 커널의 표준편차(ms). 각 이벤트에 시간 거리 기반 가우시안 가중치를 주어
   * 평균 내므로, 이 값이 클수록 흔들림이 더 강하게 감쇠된다(SPEC: 스무딩 끔/약/강).
   * 기본값은 '약'과 같다.
   */
  smoothingMs: 120,
  /** 스무딩 강도 프리셋(sigma, ms) — 끔/약/강. 0이면 스무딩하지 않는다. */
  smoothingLevels: [
    { label: '끔', value: 0 },
    { label: '약', value: 120 },
    { label: '강', value: 280 }
  ] as const,
  /** 클릭 하이라이트(리플+눌림)가 지속되는 시간(ms). */
  clickHighlightMs: 400
} as const

/**
 * 키 오버레이 튜닝 수치. 규칙만 테스트로 고정하고 값은 실험으로 정한다.
 */
export const KEYSTROKE_DEFAULTS = {
  /** 키 하나가 화면에 떠 있는 시간(ms). 이 창 안이면 오버레이로 표시된다. */
  holdMs: 1200
} as const

/**
 * 그라디언트 배경 프리셋 — 차분하고 세련된 톤(GitHub 데모 영상용). 요란한 무지개는 없다.
 * 프리셋 색은 영상 콘텐츠(배경) 데이터이므로 UI 크롬 색 규칙과 무관하게 여기서 정의한다.
 * 저장 시엔 gradient 정지점이 그대로 레시피에 담기므로(자체 완결), 프리셋 목록이 바뀌어도
 * 기존 저장본은 영향받지 않는다. 사이드바 스와치는 이 목록으로 그린다.
 */
export const GRADIENT_PRESETS: readonly { id: string; label: string; gradient: GradientFill }[] = [
  { id: 'slate', label: '슬레이트', gradient: { angle: 145, stops: ['#2b2b30', '#161618'] } },
  { id: 'graphite', label: '그래파이트', gradient: { angle: 145, stops: ['#3a3a42', '#202024'] } },
  { id: 'indigo', label: '인디고', gradient: { angle: 145, stops: ['#2e2a44', '#191826'] } },
  { id: 'teal', label: '틸', gradient: { angle: 145, stops: ['#1f3a3a', '#12201f'] } },
  { id: 'plum', label: '플럼', gradient: { angle: 145, stops: ['#3a2a3a', '#1d1620'] } }
] as const

/** 섀도를 켤 때의 기본 강도. 사이드바 토글이 이 값과 0(끔) 사이를 오간다. */
export const SHADOW_ON = 0.45

/** 배경/패딩·배지 기본값. 유도(신규 녹화) 시 레시피에 담기고, 경량 편집으로 바뀐다. */
export const COMPOSITE_DEFAULTS = {
  /** 기본 배경 종류 — 신규 녹화는 그라디언트("기본값이 곧 완성본"). */
  backgroundType: 'gradient' as BackgroundKind,
  /** 기본 단색 배경색(그라디언트로 시작해도 단색 전환 시 쓸 값). */
  backgroundColor: '#1c1c1e',
  /** 기본 그라디언트 — 첫 프리셋(슬레이트). */
  gradient: GRADIENT_PRESETS[0].gradient,
  /** 기본 패딩 비율 (짧은 변의 8%). */
  padding: 0.08,
  /** 기본 라운딩(논리 px). */
  cornerRadius: 12,
  /** 신규 녹화는 섀도를 기본으로 켠다. */
  shadow: SHADOW_ON,
  /** 배지는 기본으로 켜 둔다. */
  badgeVisible: true,
  /** 맥락 문자열 기본값 — 비어 있음(맥락 배지 숨김). */
  contextLabel: '',
  /** 갓 유도한 레시피는 키 오버레이를 기본으로 켠다(키가 있으면 표시). */
  keyOverlayVisible: true
} as const

/**
 * 이벤트 좌표(포인트)를 원본 픽셀 공간으로 정규화한다. 배율은 source와 대상 논리 크기의
 * 비율(캡처 Retina 배율)이다. target이 없으면(테스트 픽스처) 좌표가 이미 source 공간에
 * 있다고 보고 그대로 둔다.
 */
function scaleSamplesToSource(
  samples: MouseSample[],
  target: CaptureTarget | undefined,
  source: FrameSize
): MouseSample[] {
  if (!target || target.width === 0 || target.height === 0) return samples
  const sx = source.width / target.width
  const sy = source.height / target.height
  if (sx === 1 && sy === 1) return samples
  return samples.map((s) => ({ ...s, x: s.x * sx, y: s.y * sy }))
}

/**
 * 자동 효과 유도: 이벤트 트랙의 클릭(down)으로부터 줌 구간 목록을 만든다.
 * mergeGapMs 이내로 이어지는 클릭들은 한 구간으로 묶여(SPEC 4) 그 사이를 팬한다.
 */
export function deriveRecipe(track: EventTrack, config: DeriveConfig): RenderRecipe {
  const zoomScale = config.zoomScale ?? ZOOM_DEFAULTS.scale
  const source = config.source

  // 이벤트 좌표는 대상의 논리 크기(포인트) 기준인데 source는 캡처 픽셀(Retina 2x)이다.
  // 렌더 파이프라인(카메라·클램프·커서·compose)은 전부 source 공간을 가정하므로,
  // 여기서 포인트→픽셀 배율을 한 번 흡수한다. target이 없는 트랙(픽스처)은 좌표가 이미
  // source 공간에 있다고 보고 배율 1을 쓴다.
  const samples = scaleSamplesToSource(track.samples, track.target, source)

  const clicks = samples
    .filter((s): s is MouseSample => s.kind === 'down')
    .sort((a, b) => a.t - b.t)

  const zoomSegments: ZoomSegment[] = []
  let group: MouseSample[] = []

  const flush = (): void => {
    if (group.length === 0) return
    const first = group[0]
    const last = group[group.length - 1]
    zoomSegments.push({
      startMs: Math.max(0, first.t - ZOOM_RAMP_MS),
      fullInAtMs: first.t,
      holdEndMs: last.t + ZOOM_DEFAULTS.holdAfterMs,
      endMs: last.t + ZOOM_DEFAULTS.holdAfterMs + ZOOM_RAMP_MS,
      // 유도 시점의 전역 배율을 이 구간의 기본 배율로 삼는다. 이후 에디터에서 구간별로 바꾼다.
      scale: zoomScale,
      keyframes: panKeyframes(group, zoomScale, source)
    })
    group = []
  }

  for (const click of clicks) {
    const prev = group[group.length - 1]
    if (prev && click.t - prev.t > ZOOM_DEFAULTS.mergeGapMs) flush()
    group.push(click)
  }
  flush()

  // 커서 트랙: 모든 이벤트를 시간순 위치 키프레임으로, 클릭은 하이라이트용으로 담는다.
  const keyframes: CursorKeyframe[] = [...samples]
    .sort((a, b) => a.t - b.t)
    .map((s) => ({ t: s.t, x: s.x, y: s.y, cursor: s.cursor }))
  const cursor: CursorTrack = {
    keyframes,
    clicks: clicks.map((c) => ({ t: c.t, x: c.x, y: c.y })),
    size: CURSOR_DEFAULTS.size,
    smoothingMs: CURSOR_DEFAULTS.smoothingMs,
    hidden: CURSOR_DEFAULTS.hidden,
    hideWhenIdle: CURSOR_DEFAULTS.hideWhenIdle,
    loopReturn: CURSOR_DEFAULTS.loopReturn
  }

  return {
    source: { width: source.width, height: source.height },
    // 배지가 표시할 논리 뷰포트 크기(포인트). 대상이 있으면 그 논리 크기를 담는다.
    ...(track.target && {
      viewport: { width: track.target.width, height: track.target.height }
    }),
    zoomScale,
    durationMs: track.durationMs,
    zoomSegments,
    cursor,
    // 클립 시퀀스: 갓 유도한 레시피는 전체를 덮는 클립 1개다.
    clips: [{ id: nextClipId([]), sourceStartMs: 0, sourceEndMs: track.durationMs, speed: 1 }],
    background: {
      type: COMPOSITE_DEFAULTS.backgroundType,
      color: COMPOSITE_DEFAULTS.backgroundColor,
      gradient: COMPOSITE_DEFAULTS.gradient,
      padding: COMPOSITE_DEFAULTS.padding,
      cornerRadius: COMPOSITE_DEFAULTS.cornerRadius,
      shadow: COMPOSITE_DEFAULTS.shadow
    },
    badge: {
      visible: COMPOSITE_DEFAULTS.badgeVisible,
      contextLabel: COMPOSITE_DEFAULTS.contextLabel
    },
    // 키 입력은 줌을 트리거하지 않는다(마우스 클릭만) — 오버레이 표시용으로만 담는다.
    keystrokes: {
      keys: [...(track.keys ?? [])].sort((a, b) => a.t - b.t),
      overlayVisible: COMPOSITE_DEFAULTS.keyOverlayVisible
    }
  }
}

/**
 * 그룹 내 클릭에서 팬 키프레임만 골라낸다 (팬 연결 규칙).
 *
 * 첫 클릭은 항상 키프레임(줌인 중심)이다. 이후 클릭은 현재 카메라 뷰 밖에 있을 때만
 * 팬으로 잇는다(키프레임 추가) — 줌아웃했다가 다시 줌인하는 대신 배율을 유지한 채 중심만
 * 옮긴다. 뷰 안 클릭은 카메라를 움직이지 않으므로 키프레임을 만들지 않는다(줌 유지).
 * 뷰 판정은 실제로 표시되는 클램핑된 중심을 기준으로 한다.
 */
function panKeyframes(group: MouseSample[], scale: number, source: FrameSize): PanKeyframe[] {
  const first = group[0]
  const keyframes: PanKeyframe[] = [{ t: first.t, x: first.x, y: first.y }]
  let center = clampCenter(first.x, first.y, scale, source)
  for (let i = 1; i < group.length; i++) {
    const c = group[i]
    if (isInsideView(center, c.x, c.y, scale, source)) continue
    keyframes.push({ t: c.t, x: c.x, y: c.y })
    center = clampCenter(c.x, c.y, scale, source)
  }
  return keyframes
}

/**
 * 레시피 샘플링: 시각 t에서의 카메라 변환을 계산한다.
 * 구간 밖이면 원본 그대로(scale 1, 프레임 중앙). 구간 안이면 줌인·유지+팬·줌아웃을
 * 이징으로 잇고, 프레임을 벗어나지 않게 중심을 클램핑한다(SPEC 3).
 */
export function sampleRecipe(recipe: RenderRecipe, t: number): CameraTransform {
  const seg = recipe.zoomSegments.find((s) => t >= s.startMs && t <= s.endMs)
  if (!seg) return neutral(recipe.source)

  let scale: number
  let center: { x: number; y: number }

  if (t < seg.fullInAtMs) {
    // 줌인 ramp: scale 1 → seg.scale, 중심은 첫 클릭.
    const p = seg.fullInAtMs > seg.startMs ? (t - seg.startMs) / (seg.fullInAtMs - seg.startMs) : 1
    scale = 1 + (seg.scale - 1) * springEase(p)
    const k = seg.keyframes[0]
    center = { x: k.x, y: k.y }
  } else if (t <= seg.holdEndMs) {
    // 유지: 완전 줌인 상태로 클릭 키프레임 사이를 팬(SPEC 팬).
    scale = seg.scale
    center = panAt(seg.keyframes, t)
  } else {
    // 줌아웃 ramp: scale seg.scale → 1, 중심은 마지막 클릭.
    const p = seg.endMs > seg.holdEndMs ? (t - seg.holdEndMs) / (seg.endMs - seg.holdEndMs) : 1
    scale = 1 + (seg.scale - 1) * (1 - springEase(p))
    const k = seg.keyframes[seg.keyframes.length - 1]
    center = { x: k.x, y: k.y }
  }

  return clampCamera(scale, center, recipe.source)
}

/**
 * 시각 t의 모션 블러 서브프레임 — 노출 창(셔터) 동안의 카메라 궤적을 균등 표본한 카메라 목록.
 * 그리기 층이 이 카메라들로 뷰를 겹쳐 누적 평균하면 전환 구간에 방향성(줌은 방사형) 블러가
 * 생긴다. 창 양끝 카메라 사이 콘텐츠의 화면 이동이 서브픽셀 미만이면(정지·팬 없는 hold) null —
 * 곧 블러 0. 노출 창 = shutter × 1프레임(fps로 프레임 간격 결정), t 중심. 창은 클립 시퀀스의
 * source 스팬 안으로 가두어(콘텐츠 밖은 이동으로 치지 않음) 스팬 경계에서 가짜 블러가 튀지 않게 한다.
 */
export function sampleMotionBlur(recipe: RenderRecipe, t: number, fps: number): CameraTransform[] | null {
  if (fps <= 0) return null
  const span = sourceSpan(recipe)
  if (t < span.startMs || t > span.endMs) return null

  const frameMs = 1000 / fps
  const half = (MOTION_BLUR_DEFAULTS.shutter * frameMs) / 2
  const t0 = Math.max(span.startMs, t - half)
  const t1 = Math.min(span.endMs, t + half)
  if (t1 <= t0) return null

  const camStart = sampleRecipe(recipe, t0)
  const camEnd = sampleRecipe(recipe, t1)

  // 창 양끝에서 콘텐츠(고정 원본점)가 화면상 얼마나 움직이는지 — 서브픽셀이면 블러 없음.
  const maxPx = maxContentShiftPx(camStart, camEnd, recipe.source)
  if (maxPx < MOTION_BLUR_DEFAULTS.minPx) return null

  // 이동량에 비례해 서브프레임 수를 정한다(밴딩 억제) — 단, 성능 상한 안에서.
  const n = Math.min(
    MOTION_BLUR_DEFAULTS.maxSubframes,
    Math.max(2, Math.ceil(maxPx / MOTION_BLUR_DEFAULTS.stepPx))
  )
  const samples: CameraTransform[] = []
  for (let i = 0; i < n; i++) {
    samples.push(sampleRecipe(recipe, t0 + ((t1 - t0) * i) / (n - 1)))
  }
  return samples
}

/**
 * 두 카메라 사이 콘텐츠(고정 원본점)의 최대 화면 이동량(원본 px 근사). 화면 위치 ≈
 * (원본점 - 카메라중심) × 배율. 팬은 균등 이동, 줌은 중심에서 멀수록 큰 이동(방사형)이라
 * 끝 뷰의 네 모서리를 대표점으로 최대치를 잡는다. 서브프레임 밀도 결정용 근사(패딩 무시).
 */
function maxContentShiftPx(a: CameraTransform, b: CameraTransform, source: FrameSize): number {
  const halfW = source.width / b.scale / 2
  const halfH = source.height / b.scale / 2
  let max = 0
  for (const ox of [-1, 1]) {
    for (const oy of [-1, 1]) {
      const qx = b.x + ox * halfW
      const qy = b.y + oy * halfH
      const dx = (qx - b.x) * b.scale - (qx - a.x) * a.scale
      const dy = (qy - b.y) * b.scale - (qy - a.y) * a.scale
      max = Math.max(max, Math.hypot(dx, dy))
    }
  }
  return max
}

/**
 * 프레임 샘플링: 시각 t에서 그려야 할 카메라·커서·클릭 파라미터를 계산한다.
 * 카메라 변환 + 스무딩된 커서 + (있다면) 클릭 하이라이트. 계산은 전부 여기(순수 층)에서 한다.
 */
export function sampleFrame(recipe: RenderRecipe, t: number): FrameSample {
  return {
    camera: sampleRecipe(recipe, t),
    cursor: sampleCursor(recipe.cursor, t, sourceSpan(recipe)),
    click: sampleClick(recipe.cursor, t)
  }
}

/**
 * 합성 파라미터 샘플링: 시각 t에서 프레임 하나를 합성하는 데 필요한 값 전체를 낸다.
 * 프레임 샘플(카메라·커서·클릭, 트림 반영)에 레시피의 배경/패딩·배지를 더한다. 배지
 * 라벨은 논리 뷰포트 크기(viewport, 포인트)에서 유도하므로, 미리보기와 익스포트가 같은
 * 문자열을 그린다. viewport가 없으면(픽스처·v1 저장본) source로 폴백한다.
 *
 * fps를 주면 전환 구간 모션 블러 서브프레임(motionBlur)을 함께 낸다 — 노출 창을 fps 프레임
 * 간격으로 잡는다. 미리보기·익스포트가 이 값을 넘겨 양쪽에 블러가 반영된다(fps 없으면 블러 없음).
 */
export function sampleComposition(recipe: RenderRecipe, t: number, fps?: number): FrameComposition {
  const frame = sampleFrame(recipe, t)
  const viewport = recipe.viewport ?? recipe.source
  const motionBlur = fps !== undefined ? sampleMotionBlur(recipe, t, fps) : null
  return {
    camera: frame.camera,
    ...(motionBlur && { motionBlur }),
    cursor: frame.cursor,
    click: frame.click,
    background: recipe.background,
    badge: {
      visible: recipe.badge.visible,
      label: `${viewport.width}×${viewport.height}`,
      contextLabel: recipe.badge.contextLabel
    },
    keyOverlay: sampleKeyOverlay(recipe, t)
  }
}

/**
 * output↔source 매핑 계층 (결정 문서 #6·좌표계 정의) — source-시간 core 위에 얹는 얇은 층.
 *
 * 클립 시퀀스는 source 오름차순·비겹침이라, 출력 시간을 클립 순서대로 소비하면 source 시간이
 * 단조 증가하는 piecewise-linear 매핑이 된다. 컷(클립 간극)은 자연히 건너뛰고, speed는 자연히
 * 압축된다. core(sampleComposition(recipe, sourceT))는 이 값을 몰라도 되며 불변이다.
 */

/**
 * 클립 시퀀스가 덮는 source 시간 스팬 [첫 클립 시작, 마지막 클립 끝]. 컷(내부 간극)은
 * 포함하지만 스팬 밖(앞뒤 트림된 원본)은 제외한다. source-시간 core(모션 블러·루프 복귀)가
 * 유효 콘텐츠 경계로 쓴다 — trim 창을 대체한다.
 */
function sourceSpan(recipe: RenderRecipe): { startMs: number; endMs: number } {
  const clips = recipe.clips
  return { startMs: clips[0].sourceStartMs, endMs: clips[clips.length - 1].sourceEndMs }
}

/** 출력 총길이(ms) = Σ (클립 source 길이 / speed). 스크러버·익스포트 길이의 기준. */
export function outputDurationMs(recipe: RenderRecipe): number {
  return recipe.clips.reduce((sum, c) => sum + (c.sourceEndMs - c.sourceStartMs) / c.speed, 0)
}

/**
 * 출력 시간 → source 시간. 클립을 순서대로 누적 소비해 어느 클립인지 찾고, 그 안에서 speed로
 * source 시간을 되돌린다. 범위 밖은 양끝으로 클램핑한다(음수 → 첫 클립 시작, 초과 → 마지막
 * 클립 끝). 컷 경계에서는 source가 점프할 수 있다(결정 #9).
 */
export function sourceAtOutput(recipe: RenderRecipe, outputMs: number): number {
  const clips = recipe.clips
  const t = Math.max(0, outputMs)
  let acc = 0
  for (const clip of clips) {
    const clipOutLen = (clip.sourceEndMs - clip.sourceStartMs) / clip.speed
    if (t <= acc + clipOutLen) {
      return clip.sourceStartMs + (t - acc) * clip.speed
    }
    acc += clipOutLen
  }
  return clips[clips.length - 1].sourceEndMs
}

/**
 * 출력 시간에서의 합성 파라미터 — 출력 시간을 source 시간으로 되돌려 core 샘플러를 호출한다.
 * 플레이어(스크러버)·익스포트가 출력 타임라인을 걸 때 쓴다. fps는 core로 그대로 전달된다.
 */
export function sampleCompositionAtOutput(
  recipe: RenderRecipe,
  outputMs: number,
  fps?: number
): FrameComposition {
  return sampleComposition(recipe, sourceAtOutput(recipe, outputMs), fps)
}

/**
 * 결정적 클립 id 생성 (결정 #8) — 현재 클립들의 숫자 접미사 최댓값 + 1을 `c<n>`으로 파생한다.
 * 난수·상태·카운터 없이 순수하다. 빈 집합이면 `c1`. 유일성은 주어진 클립 집합 안에서만 보장한다
 * (UI 선택 식별 용도). validator의 합성 클립과 편집 연산이 공유한다.
 */
export function nextClipId(clips: Clip[]): string {
  let max = 0
  for (const c of clips) {
    const m = /(\d+)$/.exec(c.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `c${max + 1}`
}

/**
 * 시각 t에 표시할 키 오버레이를 고른다. 표시 off·활성 키 없음이면 null.
 * holdMs 창 안에 든 가장 최근 키를 표시하므로(최근 우선), 연속 키는 겹치지 않고
 * 순서대로 나타난다. 페이드는 창 안 진행도(0→1)로 낸다. (컷된 source 구간의 키는
 * output↔source 매핑이 그 source 시간을 방문하지 않으므로 자연히 표시되지 않는다.)
 */
function sampleKeyOverlay(recipe: RenderRecipe, t: number): KeyOverlayState | null {
  const ks = recipe.keystrokes
  if (!ks.overlayVisible) return null

  const hold = KEYSTROKE_DEFAULTS.holdMs
  for (let i = ks.keys.length - 1; i >= 0; i--) {
    const k = ks.keys[i]
    if (t >= k.t && t < k.t + hold) {
      return { combo: k.combo, fade: (t - k.t) / hold }
    }
  }
  return null
}

/**
 * 시각 t의 커서 상태 — 스무딩 위치 + 크기 + 불투명도. 4종 후편집 컨트롤을 여기서 반영한다:
 * 완전 숨김(hidden→null), 유휴 자동 숨김(hideWhenIdle→opacity 페이드), 루프 초기위치
 * 복귀(loopReturn→마지막 loopReturnMs 동안 시작 좌표로 spring 보간). 크기(size)는 그대로 옮긴다.
 */
function sampleCursor(
  track: CursorTrack,
  t: number,
  span: { startMs: number; endMs: number }
): CursorSample | null {
  // 완전 숨김: 커서를 아예 그리지 않는다.
  if (track.hidden) return null
  const kf = track.keyframes
  if (kf.length === 0) return null

  let pos = smoothedCursorPos(kf, track.smoothingMs, t)
  let opacity = track.hideWhenIdle ? idleCursorOpacity(kf, t) : 1

  // 루프 초기위치 복귀 — 클립 시퀀스 source 스팬의 마지막 loopReturnMs 동안 시작 좌표로 spring
  // 보간한다. 스팬이 창보다 짧으면(복귀 시작이 스팬 시작 이전) 복귀 이동이 무의미하므로 건너뛴다.
  if (track.loopReturn) {
    const returnStart = span.endMs - CURSOR_DEFAULTS.loopReturnMs
    if (returnStart > span.startMs && t >= returnStart && t <= span.endMs) {
      const p = clamp((t - returnStart) / CURSOR_DEFAULTS.loopReturnMs, 0, 1)
      const e = springEase(p)
      const anchor = smoothedCursorPos(kf, track.smoothingMs, returnStart)
      const start = smoothedCursorPos(kf, track.smoothingMs, span.startMs)
      pos = { x: anchor.x + (start.x - anchor.x) * e, y: anchor.y + (start.y - anchor.y) * e }
      // 유휴 숨김으로 끝에서 숨은 상태면 복귀 시작과 함께 페이드인한다.
      if (track.hideWhenIdle) {
        const base = idleCursorOpacity(kf, returnStart)
        const inP = clamp((t - returnStart) / CURSOR_DEFAULTS.idleFadeInMs, 0, 1)
        opacity = base + (1 - base) * inP
      }
    }
  }

  return { x: pos.x, y: pos.y, cursor: cursorKindAt(kf, t), size: track.size, opacity }
}

/**
 * 스무딩된 커서 위치(원본 px): 이벤트 좌표를 시간 거리 기반 가우시안 가중 평균해 흔들림을
 * 감쇠한다. 대칭 커널이라 위치가 뒤처지지 않고 인접한 반대 방향 지터가 서로 상쇄된다.
 * sigma<=0이거나 가중치가 언더플로하면 가장 가까운 원본 이벤트 위치를 그대로 쓴다.
 */
function smoothedCursorPos(kf: CursorKeyframe[], sigma: number, t: number): { x: number; y: number } {
  if (sigma <= 0) {
    const near = nearestKeyframe(kf, t)
    return { x: near.x, y: near.y }
  }
  let sumW = 0
  let sumX = 0
  let sumY = 0
  for (const k of kf) {
    const d = (t - k.t) / sigma
    const w = Math.exp(-0.5 * d * d)
    sumW += w
    sumX += w * k.x
    sumY += w * k.y
  }
  if (sumW === 0) {
    const near = nearestKeyframe(kf, t)
    return { x: near.x, y: near.y }
  }
  return { x: sumX / sumW, y: sumY / sumW }
}

/**
 * 시각 t의 유휴 자동 숨김 불투명도(0→1). 커서가 idleHideMs 이상 정지하면 idleFadeOutMs 동안
 * ease-out으로 사라지고, 다시 움직이면 idleFadeInMs 동안 (숨었던 만큼에서) 나타난다. 연속
 * 이동 중에는 직전 이동이 최근이라 늘 1로 유지된다.
 */
function idleCursorOpacity(kf: CursorKeyframe[], t: number): number {
  const { last, prev } = cursorMoveTimes(kf, t)
  const idle = t - last
  if (idle >= CURSOR_DEFAULTS.idleHideMs) return idleFadeOpacity(idle)
  // 방금 이동한 구간 — 이동 직전 불투명도(숨었던 정도)에서 페이드인한다.
  if (idle >= CURSOR_DEFAULTS.idleFadeInMs) return 1
  const base = idleFadeOpacity(last - prev)
  return base + (1 - base) * (idle / CURSOR_DEFAULTS.idleFadeInMs)
}

/** 정지 지속시간(ms)에 대한 페이드아웃 불투명도. 임계 전 1, 창 안은 ease-out으로 1→0, 이후 0. */
function idleFadeOpacity(idleMs: number): number {
  if (idleMs < CURSOR_DEFAULTS.idleHideMs) return 1
  const f = (idleMs - CURSOR_DEFAULTS.idleHideMs) / CURSOR_DEFAULTS.idleFadeOutMs
  if (f >= 1) return 0
  // ease-out: 초반 빠르게 흐려지고 끝에서 완만히 0에 안착.
  return (1 - f) ** 3
}

/**
 * t 이하에서 커서가 마지막으로 idleMovePx 넘게 이동한 시각(last)과 그 직전 이동 시각(prev).
 * 마지막 이동 지점을 앵커로 두고, 앵커에서 idleMovePx 넘게 벗어나면 이동으로 보고 앵커를
 * 옮긴다 — 정지 중 서브픽셀 지터는 이동으로 치지 않는다. 이동이 없으면 첫 키프레임 시각.
 */
function cursorMoveTimes(kf: CursorKeyframe[], t: number): { last: number; prev: number } {
  let ax = kf[0].x
  let ay = kf[0].y
  let last = kf[0].t
  let prev = kf[0].t
  for (const k of kf) {
    if (k.t > t) break
    if (Math.hypot(k.x - ax, k.y - ay) > CURSOR_DEFAULTS.idleMovePx) {
      prev = last
      last = k.t
      ax = k.x
      ay = k.y
    }
  }
  return { last, prev }
}

/** 시각 t의 활성 클릭 하이라이트. clickHighlightMs 창 안에 든 가장 최근 클릭을 고른다. */
function sampleClick(track: CursorTrack, t: number): ClickHighlight | null {
  const dur = CURSOR_DEFAULTS.clickHighlightMs
  for (let i = track.clicks.length - 1; i >= 0; i--) {
    const c = track.clicks[i]
    if (t >= c.t && t < c.t + dur) {
      return { x: c.x, y: c.y, progress: (t - c.t) / dur }
    }
  }
  return null
}

/** 시각 t의 커서 모양 — 모양은 스무딩하지 않고 t 이하 가장 최근 이벤트의 모양을 쓴다. */
function cursorKindAt(kf: CursorKeyframe[], t: number): CursorKind {
  let kind = kf[0].cursor
  for (const k of kf) {
    if (k.t <= t) kind = k.cursor
    else break
  }
  return kind
}

/** 시간상 t에 가장 가까운 키프레임 (가중치 언더플로 시 대체용). */
function nearestKeyframe(kf: CursorKeyframe[], t: number): CursorKeyframe {
  let best = kf[0]
  for (const k of kf) {
    if (Math.abs(k.t - t) < Math.abs(best.t - t)) best = k
  }
  return best
}

/** 확대 없음 — 프레임 전체를 중앙에 둔다. */
function neutral(source: FrameSize): CameraTransform {
  return { scale: 1, x: source.width / 2, y: source.height / 2 }
}

/** 키프레임 사이 카메라 중심을 선형 보간한다. 양끝 밖에서는 끝 키프레임에 고정. */
function panAt(keyframes: PanKeyframe[], t: number): { x: number; y: number } {
  const first = keyframes[0]
  const last = keyframes[keyframes.length - 1]
  if (t <= first.t) return { x: first.x, y: first.y }
  if (t >= last.t) return { x: last.x, y: last.y }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    if (t >= a.t && t <= b.t) {
      const p = (t - a.t) / (b.t - a.t)
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }
    }
  }
  return { x: last.x, y: last.y }
}

/** 확대된 뷰가 원본 프레임을 벗어나지 않도록 중심을 가둔다(SPEC 3 가장자리 클램핑). */
function clampCamera(scale: number, center: { x: number; y: number }, source: FrameSize): CameraTransform {
  const c = clampCenter(center.x, center.y, scale, source)
  return { scale, x: c.x, y: c.y }
}

/** 확대 뷰가 프레임을 벗어나지 않는 카메라 중심으로 좌표를 가둔다. */
function clampCenter(x: number, y: number, scale: number, source: FrameSize): { x: number; y: number } {
  const halfW = source.width / scale / 2
  const halfH = source.height / scale / 2
  return {
    x: clamp(x, halfW, source.width - halfW),
    y: clamp(y, halfH, source.height - halfH)
  }
}

/**
 * 클릭이 현재 카메라 뷰(배율 scale) 안에 있는지. 뷰는 center를 중심으로 source/scale 크기다.
 * 안이면 팬하지 않고 줌을 유지한다.
 */
function isInsideView(
  center: { x: number; y: number },
  x: number,
  y: number,
  scale: number,
  source: FrameSize
): boolean {
  const halfW = source.width / scale / 2
  const halfH = source.height / scale / 2
  return Math.abs(x - center.x) <= halfW && Math.abs(y - center.y) <= halfH
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
