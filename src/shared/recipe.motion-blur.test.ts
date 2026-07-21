import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  deriveRecipe,
  sampleComposition,
  sampleMotionBlur,
  MOTION_BLUR_DEFAULTS
} from './recipe'
import type { RenderRecipe, ZoomSegment } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

const source = { width: 1000, height: 800 }
// 완전한 레시피(배경/배지/커서 등)를 유도해 두고, zoomSegments/clips만 갈아 끼워 시나리오를 만든다.
const base = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

function withSegment(seg: ZoomSegment, durationMs = 10000): RenderRecipe {
  return {
    ...base,
    durationMs,
    clips: [{ id: 'c1', sourceStartMs: 0, sourceEndMs: durationMs, speed: 1 }],
    zoomSegments: [seg]
  }
}

// 줌인/줌아웃 램프 + 정지 hold(팬 없음). 중심(500,400)은 어떤 배율에서도 클램핑되지 않는다.
const zoomSeg: ZoomSegment = {
  startMs: 0,
  fullInAtMs: 1000,
  holdEndMs: 5000,
  endMs: 6000,
  scale: 2,
  keyframes: [{ t: 1000, x: 500, y: 400 }]
}
const zoomRecipe = withSegment(zoomSeg)

// 정지 배율(2x)로 유지하며 중심만 x축으로 옮기는 팬 구간.
const panSeg: ZoomSegment = {
  startMs: 0,
  fullInAtMs: 1000,
  holdEndMs: 5000,
  endMs: 6000,
  scale: 2,
  keyframes: [
    { t: 1000, x: 300, y: 400 },
    { t: 4000, x: 700, y: 400 }
  ]
}
const panRecipe = withSegment(panSeg)

const FPS = 30

describe('모션 블러 서브프레임 샘플링: 전환 구간에만, 정지 구간엔 0', () => {
  it('정지(hold, 팬 없음) 구간은 프레임 간 이동 0 → null (블러 없음)', () => {
    // t=3000: 완전 줌인 유지, 단일 키프레임 → 창 양끝 카메라 동일.
    expect(sampleMotionBlur(zoomRecipe, 3000, FPS)).toBeNull()
  })

  it('줌 구간 밖(중립)은 null', () => {
    expect(sampleMotionBlur(zoomRecipe, 8000, FPS)).toBeNull()
  })

  it('fps<=0이면 null (블러 비활성)', () => {
    expect(sampleMotionBlur(zoomRecipe, 200, 0)).toBeNull()
  })

  it('줌인 램프는 서브프레임을 낸다 — 배율이 퍼지고 중심은 유지(방사형)', () => {
    const cams = sampleMotionBlur(zoomRecipe, 200, FPS)
    expect(cams).not.toBeNull()
    expect(cams!.length).toBeGreaterThan(1)
    // 방사형: 노출 창 동안 배율이 변한다(퍼진다).
    const scales = cams!.map((c) => c.scale)
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0)
    // 중심은 (500,400)에서 클램핑되지 않아 서브프레임 내내 고정 — 순수 방사형.
    for (const c of cams!) {
      expect(c.x).toBeCloseTo(500, 6)
      expect(c.y).toBeCloseTo(400, 6)
    }
  })

  it('줌아웃 램프도 서브프레임을 낸다', () => {
    // holdEnd=5000, end=6000 사이의 줌아웃 램프.
    const cams = sampleMotionBlur(zoomRecipe, 5300, FPS)
    expect(cams).not.toBeNull()
    const scales = cams!.map((c) => c.scale)
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0)
  })

  it('팬(유지 중 중심 이동)은 방향성 — 배율 고정, 중심만 퍼진다', () => {
    const cams = sampleMotionBlur(panRecipe, 2500, FPS)
    expect(cams).not.toBeNull()
    expect(cams!.length).toBeGreaterThan(1)
    // 배율은 정지값(2)으로 모두 동일.
    for (const c of cams!) expect(c.scale).toBe(2)
    // 중심 x는 퍼지고(방향성), y는 고정.
    const xs = cams!.map((c) => c.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0)
    for (const c of cams!) expect(c.y).toBe(400)
  })

  it('이동량이 클수록 서브프레임이 촘촘해지고, 상한(maxSubframes)을 넘지 않는다', () => {
    // 노출 창이 길수록(=낮은 fps) 프레임 간 이동이 커 서브프레임이 늘어난다.
    const slow = sampleMotionBlur(zoomRecipe, 200, 15)!
    const fast = sampleMotionBlur(zoomRecipe, 200, 60)!
    expect(slow.length).toBeGreaterThanOrEqual(fast.length)
    expect(slow.length).toBeLessThanOrEqual(MOTION_BLUR_DEFAULTS.maxSubframes)
  })

  it('결정론적 — 같은 입력은 같은 서브프레임', () => {
    expect(sampleMotionBlur(zoomRecipe, 200, FPS)).toEqual(sampleMotionBlur(zoomRecipe, 200, FPS))
  })

  it('클립 시퀀스 source 스팬 밖 시각은 null', () => {
    // 앞뒤 트림(양끝 클립 경계)으로 스팬이 [2000,4000]인 레시피 — t=200은 스팬 앞이라 null.
    const trimmed: RenderRecipe = {
      ...zoomRecipe,
      clips: [{ id: 'c1', sourceStartMs: 2000, sourceEndMs: 4000, speed: 1 }]
    }
    expect(sampleMotionBlur(trimmed, 200, FPS)).toBeNull()
  })
})

describe('sampleComposition 모션 블러 통합', () => {
  it('fps를 주면 전환 구간 합성에 motionBlur가 실린다', () => {
    const comp = sampleComposition(zoomRecipe, 200, FPS)
    expect(comp.motionBlur).toBeDefined()
    expect(comp.motionBlur!.length).toBeGreaterThan(1)
  })

  it('fps를 안 주면 motionBlur는 없다 (기존 경로 그대로)', () => {
    const comp = sampleComposition(zoomRecipe, 200)
    expect(comp.motionBlur).toBeUndefined()
  })

  it('정지 구간은 fps를 줘도 motionBlur가 없다 (블러 0)', () => {
    const comp = sampleComposition(zoomRecipe, 3000, FPS)
    expect(comp.motionBlur).toBeUndefined()
  })
})
