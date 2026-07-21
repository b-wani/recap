import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleRecipe, ZOOM_RAMP_MS } from './recipe'
import {
  deleteZoomSegment,
  moveZoomSegment,
  resizeZoomSegment,
  setZoomSegmentScale,
  trimRecipe,
  trimmedDurationMs
} from './recipe.edit'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

// 원본 1000×800, 배율 2.0으로 유도한 레시피(recipe.sample.test와 동일 픽스처)를 편집한다.
// 램프 길이는 스프링 안착 기반(ZOOM_RAMP_MS≈1516). 첫 클릭(1000)은 램프보다 일러 seg0의
// startMs가 0으로 클램핑된다.
// 구간0: start 0 · fullIn 1000 · holdEnd 4500 · end 4500+RAMP, 클릭 (400,300)→(420,310)
// 구간1: start 8000-RAMP · fullIn 8000 · holdEnd 10000 · end 10000+RAMP, 클릭 (800,600)
// 트림: [0, 12000]
const source = { width: 1000, height: 800 }
const base = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

describe('경량 편집: 줌 구간 삭제', () => {
  it('지정한 구간을 레시피에서 제거한다', () => {
    const edited = deleteZoomSegment(base, 0)
    expect(edited.zoomSegments).toHaveLength(1)
    // 남은 구간은 원래 구간1.
    expect(edited.zoomSegments[0].fullInAtMs).toBe(8000)
  })

  it('원본 레시피를 변형하지 않는다 (불변)', () => {
    deleteZoomSegment(base, 0)
    expect(base.zoomSegments).toHaveLength(2)
  })

  it('범위 밖 인덱스는 무시한다', () => {
    expect(deleteZoomSegment(base, 5).zoomSegments).toHaveLength(2)
    expect(deleteZoomSegment(base, -1).zoomSegments).toHaveLength(2)
  })

  it('삭제한 구간은 더 이상 줌을 만들지 않는다', () => {
    // 삭제 전 구간0 완전 줌인(t=1000)은 배율 2.
    expect(sampleRecipe(base, 1000).scale).toBe(2)
    // 삭제 후 같은 시각은 원본 그대로.
    const edited = deleteZoomSegment(base, 0)
    expect(sampleRecipe(edited, 1000)).toEqual({ scale: 1, x: 500, y: 400 })
  })
})

describe('경량 편집: 줌 구간 이동', () => {
  it('네 앵커와 키프레임 시각을 함께 민다', () => {
    const edited = moveZoomSegment(base, 0, 1000)
    const seg = edited.zoomSegments[0]
    expect(seg.startMs).toBe(1000) // 0 + 1000
    expect(seg.fullInAtMs).toBe(2000)
    expect(seg.holdEndMs).toBe(5500)
    expect(seg.endMs).toBe(4500 + ZOOM_RAMP_MS + 1000)
    // 둘째 클릭(420,310)은 첫 클릭 뷰 안이라 팬 키프레임이 없다 — 유일한 키프레임 시각도 함께 밀린다.
    expect(seg.keyframes).toEqual([{ t: 2000, x: 400, y: 300 }])
  })

  it('앞으로 넘치게 밀면 startMs 0에서 멈춘다', () => {
    // 구간1 startMs=8000-RAMP이므로 크게 앞으로 밀면 딱 0에서 멈추고 end도 같은 양만큼 당겨진다.
    const edited = moveZoomSegment(base, 1, -100000)
    const seg = edited.zoomSegments[1]
    expect(seg.startMs).toBe(0)
    // shift = -(8000-RAMP) → end = (10000+RAMP) - (8000-RAMP) = 2000 + 2·RAMP.
    expect(seg.endMs).toBe(2000 + 2 * ZOOM_RAMP_MS)
  })

  it('뒤로 넘치게 밀면 endMs가 durationMs에서 멈춘다', () => {
    // 구간1 endMs=10000+RAMP, durationMs=12000이므로 +5000을 주면 (2000-RAMP)만 적용된다.
    const edited = moveZoomSegment(base, 1, 5000)
    const seg = edited.zoomSegments[1]
    const shift = 12000 - (10000 + ZOOM_RAMP_MS)
    expect(seg.endMs).toBe(12000)
    expect(seg.startMs).toBe(8000 - ZOOM_RAMP_MS + shift)
  })

  it('이동은 미리보기 샘플링에 반영된다', () => {
    const edited = moveZoomSegment(base, 0, 1000)
    // 원래 완전 줌인 시각 1000은 이제 램프 도중, 새 완전 줌인은 2000.
    expect(sampleRecipe(edited, 2000)).toEqual({ scale: 2, x: 400, y: 300 })
  })
})

describe('경량 편집: 줌 구간 길이 조절', () => {
  it("앞 가장자리('start')는 startMs·fullInAtMs를 함께 옮긴다", () => {
    // 구간1(start=8000-RAMP, 앞쪽 여유 있음)에서 -300: 줌인을 300ms 일찍 시작. holdEnd·end는 그대로.
    const edited = resizeZoomSegment(base, 1, 'start', -300)
    const seg = edited.zoomSegments[1]
    expect(seg.startMs).toBe(8000 - ZOOM_RAMP_MS - 300)
    expect(seg.fullInAtMs).toBe(7700)
    expect(seg.holdEndMs).toBe(10000)
    expect(seg.endMs).toBe(10000 + ZOOM_RAMP_MS)
  })

  it("뒤 가장자리('end')는 holdEndMs·endMs를 함께 옮겨 유지를 늘린다", () => {
    const edited = resizeZoomSegment(base, 0, 'end', 1000)
    const seg = edited.zoomSegments[0]
    expect(seg.startMs).toBe(0)
    expect(seg.fullInAtMs).toBe(1000)
    expect(seg.holdEndMs).toBe(5500)
    expect(seg.endMs).toBe(4500 + ZOOM_RAMP_MS + 1000)
  })

  it("'start'는 fullInAtMs가 holdEndMs를 넘지 않게 클램핑한다", () => {
    const edited = resizeZoomSegment(base, 0, 'start', 100000)
    const seg = edited.zoomSegments[0]
    // fullInAtMs는 holdEndMs - 1(=4499)에서 멈추고, startMs는 같은 양만큼 이동.
    // 구간0 start=0, fullIn=1000 → shift = 4499-1000 = 3499.
    expect(seg.fullInAtMs).toBe(4499)
    expect(seg.startMs).toBe(3499) // 0 + 3499
  })

  it("'end'는 endMs가 durationMs를 넘지 않게 클램핑한다", () => {
    const edited = resizeZoomSegment(base, 1, 'end', 100000)
    const seg = edited.zoomSegments[1]
    const shift = 12000 - (10000 + ZOOM_RAMP_MS)
    expect(seg.endMs).toBe(12000)
    expect(seg.holdEndMs).toBe(10000 + shift)
  })

  it('유지 연장은 샘플링에 반영된다', () => {
    // 원래 t=4600은 줌아웃 램프 도중(scale<2). 뒤로 1000 늘리면 아직 유지 → scale 2.
    expect(sampleRecipe(base, 4600).scale).toBeLessThan(2)
    const edited = resizeZoomSegment(base, 0, 'end', 1000)
    expect(sampleRecipe(edited, 4600).scale).toBe(2)
  })
})

describe('경량 편집: 구간별 줌 배율 (#23)', () => {
  it('지정 구간의 배율만 바꾸고 다른 구간은 보존한다', () => {
    const edited = setZoomSegmentScale(base, 0, 2.5)
    expect(edited.zoomSegments[0].scale).toBe(2.5)
    // 구간1은 그대로(유도 시 전역 2.0).
    expect(edited.zoomSegments[1].scale).toBe(2.0)
    // 전역 배율은 건드리지 않는다.
    expect(edited.zoomScale).toBe(base.zoomScale)
  })

  it('시간 앵커와 팬 키프레임을 보존한다 (배율만 바뀐다)', () => {
    const edited = setZoomSegmentScale(base, 0, 2.5)
    const seg = edited.zoomSegments[0]
    expect(seg.startMs).toBe(0)
    expect(seg.fullInAtMs).toBe(1000)
    expect(seg.holdEndMs).toBe(4500)
    expect(seg.endMs).toBe(4500 + ZOOM_RAMP_MS)
    expect(seg.keyframes).toEqual(base.zoomSegments[0].keyframes)
  })

  it('허용 이산값(1.5/2.0/2.5) 중 가장 가까운 값으로 스냅한다', () => {
    expect(setZoomSegmentScale(base, 0, 2.4).zoomSegments[0].scale).toBe(2.5)
    expect(setZoomSegmentScale(base, 0, 1.6).zoomSegments[0].scale).toBe(1.5)
    expect(setZoomSegmentScale(base, 0, 1.9).zoomSegments[0].scale).toBe(2.0)
    // 범위 밖 값도 가장 가까운 이산값으로 가둔다.
    expect(setZoomSegmentScale(base, 0, 5).zoomSegments[0].scale).toBe(2.5)
    expect(setZoomSegmentScale(base, 0, 0.5).zoomSegments[0].scale).toBe(1.5)
  })

  it('범위 밖 인덱스는 무시한다', () => {
    expect(setZoomSegmentScale(base, 5, 2.5)).toBe(base)
    expect(setZoomSegmentScale(base, -1, 2.5)).toBe(base)
  })

  it('원본 레시피를 변형하지 않는다 (불변)', () => {
    setZoomSegmentScale(base, 0, 2.5)
    expect(base.zoomSegments[0].scale).toBe(2.0)
  })

  it('배율 변경이 샘플링에 반영되고 팬 연결은 유지된다', () => {
    // 팬 픽스처: 뷰 밖 클릭이 팬으로 이어지는 단일 구간.
    const panBase = deriveRecipe(loadTrack('event-track-pan.json'), { source })
    const edited = setZoomSegmentScale(panBase, 0, 1.5)
    // 완전 줌인 배율이 1.5로 바뀐다.
    expect(sampleRecipe(edited, 1000).scale).toBe(1.5)
    expect(sampleRecipe(edited, 2500).scale).toBe(1.5)
    // 팬 키프레임 개수(카메라 동선)는 유지된다 — 여전히 두 지점 사이를 팬한다.
    expect(edited.zoomSegments[0].keyframes).toHaveLength(2)
  })
})

describe('경량 편집: 앞뒤 트리밍', () => {
  it('트림 창을 좁힌다', () => {
    const edited = trimRecipe(base, { startMs: 2000, endMs: 9000 })
    expect(edited.trim).toEqual({ startMs: 2000, endMs: 9000 })
    expect(trimmedDurationMs(edited)).toBe(7000)
  })

  it('한쪽만 바꿔도 나머지는 유지된다', () => {
    const edited = trimRecipe(base, { startMs: 3000 })
    expect(edited.trim).toEqual({ startMs: 3000, endMs: 12000 })
  })

  it('창을 [0, durationMs] 안으로 클램핑한다', () => {
    const edited = trimRecipe(base, { startMs: -500, endMs: 99999 })
    expect(edited.trim).toEqual({ startMs: 0, endMs: 12000 })
  })

  it('startMs가 endMs를 지나치지 않게 막는다', () => {
    const edited = trimRecipe(base, { startMs: 9000, endMs: 5000 })
    expect(edited.trim.startMs).toBeLessThan(edited.trim.endMs)
  })

  it('트림은 샘플링에 반영된다 — 창 밖은 원본 그대로', () => {
    const edited = trimRecipe(base, { startMs: 2000, endMs: 9000 })
    // 창 밖 시각(구간1 완전 줌인 t=8000은 창 안이라 그대로 줌, t=10000은 창 밖).
    expect(sampleRecipe(base, 10000).scale).toBe(2)
    expect(sampleRecipe(edited, 10000)).toEqual({ scale: 1, x: 500, y: 400 })
    // 창 안은 편집 전과 동일하게 줌.
    expect(sampleRecipe(edited, 8000).scale).toBe(2)
  })

  it('원본 레시피의 트림을 변형하지 않는다 (불변)', () => {
    trimRecipe(base, { startMs: 3000 })
    expect(base.trim).toEqual({ startMs: 0, endMs: 12000 })
  })
})
