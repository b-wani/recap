import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, ZOOM_DEFAULTS } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

const source = { width: 1000, height: 800 }

describe('자동 효과 유도: 이벤트 트랙 → 렌더 레시피', () => {
  it('클릭 이벤트 픽스처에서 규칙대로 줌 구간이 생성된다', () => {
    const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

    // 3초 이내로 이어진 두 클릭(1000, 2500)은 한 구간, 5.5초 뒤 클릭(8000)은 별도 구간.
    expect(recipe.zoomSegments).toHaveLength(2)

    const [seg0, seg1] = recipe.zoomSegments

    // 구간0: 첫 클릭 0.5초 전 줌인 시작, 마지막 활동 2초 후 줌아웃, +0.5초 완전 해제.
    expect(seg0.startMs).toBe(1000 - ZOOM_DEFAULTS.rampInMs)
    expect(seg0.fullInAtMs).toBe(1000)
    expect(seg0.holdEndMs).toBe(2500 + ZOOM_DEFAULTS.holdAfterMs)
    expect(seg0.endMs).toBe(2500 + ZOOM_DEFAULTS.holdAfterMs + ZOOM_DEFAULTS.rampOutMs)
    // 둘째 클릭(420,310)은 첫 클릭(400,300)의 확대 뷰 안이라 팬을 만들지 않는다(줌 유지).
    // 활동 시각으로 holdEnd만 늘리고 카메라는 첫 클릭에 머문다.
    expect(seg0.keyframes).toEqual([{ t: 1000, x: 400, y: 300 }])

    // 구간1: 단일 클릭.
    expect(seg1.fullInAtMs).toBe(8000)
    expect(seg1.keyframes).toEqual([{ t: 8000, x: 800, y: 600 }])
  })

  it('클릭 트리거만 줌을 만든다 — 이동 이벤트는 무시된다 (SPEC 1)', () => {
    const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })
    const keyframeTimes = recipe.zoomSegments.flatMap((s) => s.keyframes.map((k) => k.t))
    // move 이벤트 시각(500, 1500, 6000)은 어떤 키프레임에도 나타나지 않는다.
    for (const moveT of [500, 1500, 6000]) expect(keyframeTimes).not.toContain(moveT)
  })

  it('확대 중 뷰 밖 클릭은 줌아웃 대신 팬으로 연결된다 (issue #4)', () => {
    // 픽스처: 1.0s (300,250) → 2.5s (700,550). 배율 2.0에서 둘째 클릭은 첫 뷰 밖.
    const recipe = deriveRecipe(loadTrack('event-track-pan.json'), { source })

    // 두 클릭이 한 구간으로 묶인다 — 줌아웃/재줌인(구간 2개)이 아니다.
    expect(recipe.zoomSegments).toHaveLength(1)
    // 뷰 밖 클릭이 팬 키프레임으로 이어진다 — 배율 유지, 중심만 이동.
    expect(recipe.zoomSegments[0].keyframes).toEqual([
      { t: 1000, x: 300, y: 250 },
      { t: 2500, x: 700, y: 550 }
    ])
  })

  it('확대 중 뷰 안 클릭은 팬을 만들지 않고 줌 구간을 유지한다 (issue #4)', () => {
    // 뷰 안 클릭이 이어져도 키프레임은 첫 클릭 하나, holdEnd는 마지막 활동으로 유지된다.
    const track: EventTrack = {
      protocolVersion: 1,
      startedAt: 0,
      durationMs: 8000,
      samples: [
        { t: 1000, kind: 'down', x: 500, y: 400, cursor: 'pointer' },
        { t: 2000, kind: 'down', x: 520, y: 410, cursor: 'pointer' },
        { t: 3000, kind: 'down', x: 480, y: 390, cursor: 'pointer' }
      ]
    }
    const [seg] = deriveRecipe(track, { source }).zoomSegments
    expect(seg.keyframes).toEqual([{ t: 1000, x: 500, y: 400 }])
    // 세 클릭 모두 확대를 유지 — 마지막 활동(3000) 기준으로 줌아웃 시작.
    expect(seg.holdEndMs).toBe(3000 + ZOOM_DEFAULTS.holdAfterMs)
  })

  it('클릭이 없으면 줌 구간도 없다', () => {
    const track: EventTrack = {
      protocolVersion: 1,
      startedAt: 0,
      durationMs: 3000,
      samples: [{ t: 100, kind: 'move', x: 10, y: 10, cursor: 'arrow' }]
    }
    expect(deriveRecipe(track, { source }).zoomSegments).toEqual([])
  })

  it('전역 배율과 원본 크기를 레시피에 담는다', () => {
    const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source, zoomScale: 2.5 })
    expect(recipe.zoomScale).toBe(2.5)
    expect(recipe.source).toEqual(source)
    expect(recipe.durationMs).toBe(12000)
  })

  it('배율 미지정 시 기본 2.0x를 쓴다 (SPEC 6)', () => {
    const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })
    expect(recipe.zoomScale).toBe(2.0)
  })
})
