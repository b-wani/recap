import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleComposition, COMPOSITE_DEFAULTS, KEYSTROKE_DEFAULTS } from './recipe'
import type { RenderRecipe } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

// 원본 1000×800, 배율 2.0으로 유도한 레시피를 합성 파라미터로 샘플링한다.
const source = { width: 1000, height: 800 }
const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

describe('합성 파라미터 샘플링: (렌더 레시피, 시각 t) → 프레임 합성 파라미터', () => {
  it('샘플링 출력에 카메라·배경/패딩·배지가 모두 담긴다', () => {
    const comp = sampleComposition(recipe, 0)
    // 카메라: 구간 밖이라 원본 그대로.
    expect(comp.camera).toEqual({ scale: 1, x: 500, y: 400 })
    // 배경/패딩: 기본값이 그대로 실린다.
    expect(comp.background).toEqual({
      color: COMPOSITE_DEFAULTS.backgroundColor,
      padding: COMPOSITE_DEFAULTS.padding
    })
    // 배지: 기본 on, 라벨은 녹화된 화면 크기, 맥락은 기본 빈 문자열.
    expect(comp.badge).toEqual({ visible: true, label: '1000×800', contextLabel: '' })
  })

  it('배지 라벨은 녹화된 화면 크기(source) 기준으로 합성된다', () => {
    const wide = deriveRecipe(loadTrack('event-track-clicks.json'), {
      source: { width: 2880, height: 1800 }
    })
    expect(sampleComposition(wide, 0).badge.label).toBe('2880×1800')
  })

  it('배지 라벨은 target이 있으면 논리 뷰포트(포인트) 크기를 쓴다 — 픽셀 source가 아니다', () => {
    // 캡처는 Retina 2x라 source는 2880×1800이지만, 배지는 개발자가 보는 뷰포트(1440×900)를 보여야 한다.
    const track: EventTrack = {
      protocolVersion: 3,
      startedAt: 0,
      durationMs: 4000,
      target: { kind: 'display', id: 'display:1', title: '전체 화면', width: 1440, height: 900 },
      samples: [{ t: 1000, kind: 'down', x: 1400, y: 850, cursor: 'pointer' }]
    }
    const recipe = deriveRecipe(track, { source: { width: 2880, height: 1800 } })
    expect(sampleComposition(recipe, 0).badge.label).toBe('1440×900')
  })

  it('배지를 끄면 샘플링 출력에 off가 반영된다', () => {
    const off = { ...recipe, badge: { ...recipe.badge, visible: false } }
    const comp = sampleComposition(off, 0)
    expect(comp.badge.visible).toBe(false)
    // off여도 라벨은 계산되어 있어, 켜는 순간 같은 문자열을 그린다.
    expect(comp.badge.label).toBe('1000×800')
  })

  it('맥락 문자열을 배지 상태에 싣는다 (#24)', () => {
    const withContext = { ...recipe, badge: { ...recipe.badge, contextLabel: 'feat/v2 @ abc123' } }
    const comp = sampleComposition(withContext, 0)
    expect(comp.badge.contextLabel).toBe('feat/v2 @ abc123')
    // 뷰포트 라벨과 함께 실린다.
    expect(comp.badge.label).toBe('1000×800')
  })

  it('맥락 문자열이 비면 빈 값으로 낸다 (뷰포트 배지만) (#24)', () => {
    const comp = sampleComposition(recipe, 0)
    expect(comp.badge.contextLabel).toBe('')
  })

  it('맥락 문자열은 시각과 무관하게(줌 구간 안에서도) 실린다 (#24)', () => {
    const withContext = { ...recipe, badge: { ...recipe.badge, contextLabel: '#24' } }
    // 완전 줌인 시점에서도 그대로.
    expect(sampleComposition(withContext, 1000).badge.contextLabel).toBe('#24')
  })

  it('배경/패딩을 조절하면 샘플링 출력에 그대로 반영된다', () => {
    const styled = { ...recipe, background: { color: '#000000', padding: 0.2 } }
    expect(sampleComposition(styled, 0).background).toEqual({ color: '#000000', padding: 0.2 })
  })

  describe('키 오버레이 샘플링 (#25)', () => {
    const hold = KEYSTROKE_DEFAULTS.holdMs
    const withKeys = (keys: { t: number; combo: string }[], overlayVisible = true): RenderRecipe => ({
      ...recipe,
      keystrokes: { keys, overlayVisible }
    })

    it('활성 창 안이면 조합 문자열과 페이드 진행도를 낸다', () => {
      const r = withKeys([{ t: 1000, combo: '⌘S' }])
      // 방금 눌린 순간: fade 0.
      expect(sampleComposition(r, 1000).keyOverlay).toEqual({ combo: '⌘S', fade: 0 })
      // 창 중간: fade는 창 안 진행도.
      const mid = sampleComposition(r, 1000 + hold / 2).keyOverlay
      expect(mid?.combo).toBe('⌘S')
      expect(mid?.fade).toBeCloseTo(0.5, 10)
    })

    it('활성 창 밖이면 비운다(null)', () => {
      const r = withKeys([{ t: 1000, combo: '⌘S' }])
      // 누르기 전.
      expect(sampleComposition(r, 500).keyOverlay).toBeNull()
      // 창이 끝난 뒤.
      expect(sampleComposition(r, 1000 + hold).keyOverlay).toBeNull()
    })

    it('연속 키는 겹치지 않고 가장 최근 것을 표시한다', () => {
      // 두 키가 창이 겹치도록 100ms 간격. 겹치는 시점엔 최근(둘째)만 표시.
      const r = withKeys([
        { t: 1000, combo: '⌘S' },
        { t: 1100, combo: '⌥⌘I' }
      ])
      expect(sampleComposition(r, 1050).keyOverlay?.combo).toBe('⌘S')
      // 둘째가 눌린 뒤에는 최근 것 우선.
      expect(sampleComposition(r, 1150).keyOverlay?.combo).toBe('⌥⌘I')
    })

    it('오버레이 표시가 off면 항상 null', () => {
      const r = withKeys([{ t: 1000, combo: '⌘S' }], false)
      expect(sampleComposition(r, 1000).keyOverlay).toBeNull()
    })

    it('트림 창 밖이면 키 오버레이도 비운다', () => {
      const r: RenderRecipe = {
        ...withKeys([{ t: 1000, combo: '⌘S' }]),
        trim: { startMs: 1500, endMs: recipe.durationMs }
      }
      // t=1000은 트림 시작 이전 → null.
      expect(sampleComposition(r, 1000).keyOverlay).toBeNull()
    })

    it('키가 없으면 null (기본 유도 레시피)', () => {
      expect(sampleComposition(recipe, 1000).keyOverlay).toBeNull()
    })
  })

  it('배경/패딩·배지는 시각과 무관하게(줌 구간 안에서도) 합성 파라미터에 실린다', () => {
    // 완전 줌인 시점(구간0, t=1000)에서도 배경/패딩·배지가 그대로 담긴다.
    const comp = sampleComposition(recipe, 1000)
    expect(comp.camera.scale).toBe(2)
    expect(comp.background).toEqual({
      color: COMPOSITE_DEFAULTS.backgroundColor,
      padding: COMPOSITE_DEFAULTS.padding
    })
    expect(comp.badge).toEqual({ visible: true, label: '1000×800', contextLabel: '' })
  })
})
