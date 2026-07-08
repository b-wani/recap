import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleFrame, sampleRecipe, CURSOR_DEFAULTS } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

const source = { width: 1000, height: 800 }

describe('프레임 샘플링: 스무딩된 커서 (AC 1)', () => {
  // 지터 픽스처: 커서가 x축을 따라 직진하지만 y가 +20/-20으로 흔들린다(추세선 y=0).
  const recipe = deriveRecipe(loadTrack('event-track-jitter.json'), { source })

  it('대칭 지터는 추세선으로 정확히 상쇄된다 (스무딩 강도와 무관)', () => {
    // t=250은 모든 샘플의 시간 대칭 중심 → +지터와 -지터가 서로 상쇄되어 추세에 안착.
    const s = sampleFrame(recipe, 250)
    expect(s.cursor).not.toBeNull()
    expect(s.cursor!.x).toBeCloseTo(250, 6)
    expect(s.cursor!.y).toBeCloseTo(0, 6)
  })

  it('원본 이벤트의 흔들림이 감쇠된다 — 각 지터 시각에서 추세 이탈이 줄어든다', () => {
    // 원본 y는 각 시각에서 추세(0)로부터 20px 벗어나 있다.
    for (const [t, rawY] of [
      [100, 20],
      [200, -20],
      [300, 20],
      [400, -20]
    ] as const) {
      const s = sampleFrame(recipe, t)
      expect(s.cursor).not.toBeNull()
      // 스무딩된 위치는 원본보다 추세(0)에 더 가깝다.
      expect(Math.abs(s.cursor!.y)).toBeLessThan(Math.abs(rawY))
    }
  })

  it('커서 모양은 스무딩하지 않고 가장 최근 이벤트의 모양을 쓴다', () => {
    // 클릭 픽스처: t=1000 이후 커서 pointer, t=6000 이후 arrow.
    const clicks = deriveRecipe(loadTrack('event-track-clicks.json'), { source })
    expect(sampleFrame(clicks, 1200).cursor!.cursor).toBe('pointer')
    expect(sampleFrame(clicks, 7000).cursor!.cursor).toBe('arrow')
  })

  it('커서 이벤트가 없으면 cursor는 null', () => {
    const empty: EventTrack = { protocolVersion: 1, startedAt: 0, durationMs: 1000, samples: [] }
    expect(sampleFrame(deriveRecipe(empty, { source }), 500).cursor).toBeNull()
  })
})

describe('커서 크기·스무딩 설정 (#35)', () => {
  const recipe = deriveRecipe(loadTrack('event-track-jitter.json'), { source })

  it('유도한 레시피의 커서 트랙은 기본 크기·스무딩을 담는다', () => {
    expect(recipe.cursor.size).toBe(CURSOR_DEFAULTS.size)
    expect(recipe.cursor.smoothingMs).toBe(CURSOR_DEFAULTS.smoothingMs)
  })

  it('샘플링된 커서는 레시피의 크기 배율을 그대로 옮긴다', () => {
    const big = { ...recipe, cursor: { ...recipe.cursor, size: 2 } }
    expect(sampleFrame(big, 250).cursor!.size).toBe(2)
  })

  it('스무딩을 끄면(sigma 0) 흔들림이 감쇠되지 않고 원본 위치를 쓴다', () => {
    const off = { ...recipe, cursor: { ...recipe.cursor, smoothingMs: 0 } }
    // t=100의 원본 지터 y=20 — 스무딩 끔이면 감쇠 없이 원본에 안착한다.
    expect(sampleFrame(off, 100).cursor!.y).toBeCloseTo(20, 6)
  })

  it('스무딩이 강할수록 같은 시각의 추세 이탈이 더 줄어든다', () => {
    const weak = sampleFrame({ ...recipe, cursor: { ...recipe.cursor, smoothingMs: 120 } }, 100)
    const strong = sampleFrame({ ...recipe, cursor: { ...recipe.cursor, smoothingMs: 280 } }, 100)
    expect(Math.abs(strong.cursor!.y)).toBeLessThan(Math.abs(weak.cursor!.y))
  })
})

describe('프레임 샘플링: 클릭 하이라이트 (AC 2)', () => {
  // 클릭(down) 시각: 1000(400,300), 2500(420,310), 8000(800,600).
  const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })
  const dur = CURSOR_DEFAULTS.clickHighlightMs

  it('클릭 순간에 하이라이트가 켜지고 진행도 0에서 시작한다', () => {
    const s = sampleFrame(recipe, 1000)
    expect(s.click).toEqual({ x: 400, y: 300, progress: 0 })
  })

  it('하이라이트 진행도가 지속시간에 걸쳐 0→1로 진행한다', () => {
    const s = sampleFrame(recipe, 1000 + dur / 2)
    expect(s.click).not.toBeNull()
    expect(s.click!.progress).toBeCloseTo(0.5, 10)
    expect(s.click!.x).toBe(400)
    expect(s.click!.y).toBe(300)
  })

  it('지속시간이 끝나면 하이라이트가 꺼진다 (창은 열림-닫힘 반개구간)', () => {
    expect(sampleFrame(recipe, 1000 + dur).click).toBeNull()
  })

  it('클릭에서 먼 시각에는 하이라이트가 없다', () => {
    expect(sampleFrame(recipe, 6000).click).toBeNull()
  })

  it('여러 클릭 각각에서 하이라이트가 켜진다', () => {
    expect(sampleFrame(recipe, 2500).click).toEqual({ x: 420, y: 310, progress: 0 })
    expect(sampleFrame(recipe, 8000).click).toEqual({ x: 800, y: 600, progress: 0 })
  })
})

describe('프레임 샘플링: 카메라 변환은 sampleRecipe와 동일', () => {
  const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })
  it('camera 필드는 기존 카메라 샘플링 결과를 그대로 담는다', () => {
    for (const t of [0, 750, 1750, 4750, 8000]) {
      expect(sampleFrame(recipe, t).camera).toEqual(sampleRecipe(recipe, t))
    }
  })
})
