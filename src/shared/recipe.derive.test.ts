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
    // 두 클릭이 팬 키프레임으로 보존된다 (그 사이 줌 유지·팬).
    expect(seg0.keyframes).toEqual([
      { t: 1000, x: 400, y: 300 },
      { t: 2500, x: 420, y: 310 }
    ])

    // 구간1: 단일 클릭.
    expect(seg1.fullInAtMs).toBe(8000)
    expect(seg1.keyframes).toEqual([{ t: 8000, x: 800, y: 600 }])
  })

  it('클릭 트리거만 줌을 만든다 — 이동 이벤트는 무시된다 (SPEC 1)', () => {
    const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })
    const keyframeTimes = recipe.zoomSegments.flatMap((s) => s.keyframes.map((k) => k.t))
    // move 이벤트 시각(500, 1500, 6000)은 어떤 키프레임에도 나타나지 않는다.
    expect(keyframeTimes).toEqual([1000, 2500, 8000])
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
