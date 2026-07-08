import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_STEPS,
  isFirstStep,
  isLastStep,
  canGoBack,
  advance,
  goBack,
  arePermissionsSatisfied,
  canAdvance
} from './onboarding'

const LAST = ONBOARDING_STEPS.length - 1

describe('온보딩 단계 목록: 7단계 순서 (PRD #45)', () => {
  it('권한 → 개요 → 기능 상세×3 → 단축키 → FAQ 순으로 7단계다', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'permissions',
      'overview',
      'feature-recording',
      'feature-editing',
      'feature-export',
      'shortcuts',
      'faq'
    ])
  })

  it('모든 단계에 제목이 있다 (이 슬라이스의 콘텐츠는 제목 스텁)', () => {
    for (const step of ONBOARDING_STEPS) expect(step.title.length).toBeGreaterThan(0)
  })
})

describe('후퇴 규칙: 첫 단계에서는 못 돌아간다', () => {
  it('첫 단계에서만 isFirstStep이 참이고 후퇴 불가다', () => {
    expect(isFirstStep(0)).toBe(true)
    expect(canGoBack(0)).toBe(false)
    expect(goBack(0)).toBe(0) // 첫 단계면 그대로 머문다
  })

  it('중간·마지막 단계에서는 후퇴 가능하고 한 단계 뒤로 간다', () => {
    expect(canGoBack(1)).toBe(true)
    expect(goBack(3)).toBe(2)
    expect(canGoBack(LAST)).toBe(true)
    expect(goBack(LAST)).toBe(LAST - 1)
  })
})

describe('전진·완료 규칙: 마지막 단계의 다음은 완료', () => {
  it('마지막 단계에서만 isLastStep이 참이다', () => {
    expect(isLastStep(LAST)).toBe(true)
    expect(isLastStep(0)).toBe(false)
  })

  it('마지막이 아니면 다음 단계 인덱스로 전진한다', () => {
    expect(advance(0)).toEqual({ kind: 'step', index: 1 })
    expect(advance(LAST - 1)).toEqual({ kind: 'step', index: LAST })
  })

  it('마지막 단계에서 다음을 누르면 온보딩 완료다', () => {
    expect(advance(LAST)).toEqual({ kind: 'complete' })
  })

  it('권한 단계(첫 단계)도 이 슬라이스에서는 항상 전진 가능하다 (#47에서 게이팅)', () => {
    expect(advance(0)).toEqual({ kind: 'step', index: 1 })
  })
})

describe('권한 충족 판정: 둘 다 granted여야 core 충족 (#47)', () => {
  it('둘 다 granted면 충족이다', () => {
    expect(arePermissionsSatisfied({ screen: true, accessibility: true })).toBe(true)
  })

  it('하나라도 미충족이면 충족이 아니다', () => {
    expect(arePermissionsSatisfied({ screen: true, accessibility: false })).toBe(false)
    expect(arePermissionsSatisfied({ screen: false, accessibility: true })).toBe(false)
    expect(arePermissionsSatisfied({ screen: false, accessibility: false })).toBe(false)
  })
})

describe('전진 게이트: 권한 단계는 두 권한이 모두 granted여야 전진 가능 (#47)', () => {
  const PERMISSIONS_INDEX = ONBOARDING_STEPS.findIndex((s) => s.id === 'permissions')

  it('권한 단계에서 권한 미충족이면 전진 불가다', () => {
    expect(canAdvance(PERMISSIONS_INDEX, { screen: false, accessibility: false })).toBe(false)
    expect(canAdvance(PERMISSIONS_INDEX, { screen: true, accessibility: false })).toBe(false)
    expect(canAdvance(PERMISSIONS_INDEX, { screen: false, accessibility: true })).toBe(false)
  })

  it('권한 단계에서 둘 다 granted면 전진 가능하다', () => {
    expect(canAdvance(PERMISSIONS_INDEX, { screen: true, accessibility: true })).toBe(true)
  })

  it('권한 단계가 아니면 권한과 무관하게 전진 가능하다', () => {
    expect(canAdvance(1, { screen: false, accessibility: false })).toBe(true)
    expect(canAdvance(LAST, { screen: false, accessibility: false })).toBe(true)
  })
})
