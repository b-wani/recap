import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, outputDurationMs, sampleRecipe, ZOOM_RAMP_MS } from './recipe'
import {
  deleteClip,
  deleteZoomSegment,
  moveZoomSegment,
  resizeZoomSegment,
  setClipBoundary,
  setClipSpeed,
  setZoomSegmentScale,
  splitClip
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

describe('경량 편집: 앞뒤 트리밍 (양끝 클립 경계)', () => {
  it("앞 트림('start')은 첫 클립 시작을 올린다", () => {
    const edited = setClipBoundary(base, 'start', 2000)
    expect(edited.clips[0].sourceStartMs).toBe(2000)
    expect(edited.clips[0].sourceEndMs).toBe(12000)
    // 출력 길이는 남은 창(2000~12000)만큼.
    expect(outputDurationMs(edited)).toBe(10000)
  })

  it("뒤 트림('end')은 마지막 클립 끝을 내린다", () => {
    const edited = setClipBoundary(base, 'end', 9000)
    expect(edited.clips[base.clips.length - 1].sourceEndMs).toBe(9000)
    expect(outputDurationMs(edited)).toBe(9000)
  })

  it('경계를 [0, durationMs] 안으로 클램핑한다', () => {
    expect(setClipBoundary(base, 'start', -500).clips[0].sourceStartMs).toBe(0)
    expect(setClipBoundary(base, 'end', 99999).clips[0].sourceEndMs).toBe(12000)
  })

  it('앞 경계가 클립 끝을 지나치지 않게 막는다', () => {
    const edited = setClipBoundary(base, 'start', 99999)
    expect(edited.clips[0].sourceStartMs).toBeLessThan(edited.clips[0].sourceEndMs)
  })

  it('원본 레시피를 변형하지 않는다 (불변)', () => {
    setClipBoundary(base, 'start', 3000)
    expect(base.clips[0]).toEqual({ id: 'c1', sourceStartMs: 0, sourceEndMs: 12000, speed: 1 })
  })
})

describe('경량 편집: 컷 — 분할·삭제', () => {
  it('클립을 지정 지점에서 둘로 나눈다 (인접·속도 물림·새 id)', () => {
    const edited = splitClip(base, 'c1', 5000)
    expect(edited.clips).toHaveLength(2)
    expect(edited.clips[0]).toEqual({ id: 'c1', sourceStartMs: 0, sourceEndMs: 5000, speed: 1 })
    expect(edited.clips[1]).toEqual({ id: 'c2', sourceStartMs: 5000, sourceEndMs: 12000, speed: 1 })
    // 인접(간극 없음)이라 분할만으로는 출력 길이가 그대로다.
    expect(outputDurationMs(edited)).toBe(12000)
  })

  it('분할점이 클립 밖이거나 양끝이면 무시한다', () => {
    expect(splitClip(base, 'c1', 0)).toBe(base)
    expect(splitClip(base, 'c1', 12000)).toBe(base)
    expect(splitClip(base, 'c1', 99999)).toBe(base)
  })

  it('없는 클립 id는 무시한다', () => {
    expect(splitClip(base, 'nope', 5000)).toBe(base)
  })

  it('분할 후 한쪽을 삭제하면 컷(간극)이 생긴다', () => {
    const split = splitClip(base, 'c1', 5000) // [0,5000] + [5000,12000]
    const cut = deleteClip(split, 'c1') // 앞 조각 제거 → 간극 [0,5000]
    expect(cut.clips).toEqual([{ id: 'c2', sourceStartMs: 5000, sourceEndMs: 12000, speed: 1 }])
    expect(outputDurationMs(cut)).toBe(7000)
  })

  it('마지막 남은 클립 1개는 삭제하지 않는다 (출력 보존)', () => {
    expect(deleteClip(base, 'c1')).toBe(base)
  })

  it('없는 클립 id 삭제는 무시한다', () => {
    const split = splitClip(base, 'c1', 5000)
    expect(deleteClip(split, 'nope')).toBe(split)
  })

  it('원본 레시피를 변형하지 않는다 (불변)', () => {
    splitClip(base, 'c1', 5000)
    expect(base.clips).toHaveLength(1)
  })
})

describe('경량 편집: 클립 속도', () => {
  it('지정 클립의 속도를 바꾸고 출력 길이가 압축된다', () => {
    const edited = setClipSpeed(base, 'c1', 2)
    expect(edited.clips[0].speed).toBe(2)
    expect(outputDurationMs(edited)).toBe(6000) // 12000 / 2
  })

  it('허용 이산값(0.5/1/1.5/2) 중 가장 가까운 값으로 스냅한다', () => {
    expect(setClipSpeed(base, 'c1', 1.9).clips[0].speed).toBe(2)
    expect(setClipSpeed(base, 'c1', 0.6).clips[0].speed).toBe(0.5)
    expect(setClipSpeed(base, 'c1', 5).clips[0].speed).toBe(2)
  })

  it('없는 클립 id는 무시한다', () => {
    expect(setClipSpeed(base, 'nope', 2)).toBe(base)
  })

  it('한 클립의 속도만 바꾸고 다른 클립은 보존한다', () => {
    const split = splitClip(base, 'c1', 6000) // c1 [0,6000], c2 [6000,12000]
    const edited = setClipSpeed(split, 'c2', 2)
    expect(edited.clips[0].speed).toBe(1)
    expect(edited.clips[1].speed).toBe(2)
    // 6000(원속) + 6000/2 = 9000.
    expect(outputDurationMs(edited)).toBe(9000)
  })

  it('원본 레시피를 변형하지 않는다 (불변)', () => {
    setClipSpeed(base, 'c1', 2)
    expect(base.clips[0].speed).toBe(1)
  })
})
