import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleRecipe, springEase, ZOOM_RAMP_MS } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

// 원본 1000×800, 배율 2.0으로 유도한 레시피를 샘플링한다.
// 램프 길이는 스프링 안착 기반(ZOOM_RAMP_MS). 첫 클릭(1000)은 램프보다 일러 startMs가 0으로
// 클램핑된다.
// 구간0: start max(0,1000-RAMP) · fullIn 1000 · holdEnd 4500 · end 4500+RAMP. 첫 클릭 (400,300);
//        둘째 클릭 (420,310)은 뷰 안이라 팬 없음 → 중심은 (400,300) 유지.
// 구간1: start 8000-RAMP · fullIn 8000 · holdEnd 10000 · end 10000+RAMP, 클릭 (800,600).
//        구간1은 첫 클릭이 늦어 램프 창이 온전(=RAMP)하므로 이징 곡선 검증의 기준으로 쓴다.
const source = { width: 1000, height: 800 }
const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

describe('레시피 샘플링: (렌더 레시피, 시각 t) → 카메라 변환', () => {
  it('줌 구간 밖에서는 원본 그대로(scale 1, 프레임 중앙)', () => {
    expect(sampleRecipe(recipe, 0)).toEqual({ scale: 1, x: 500, y: 400 })
    // 구간0 종료(4500+RAMP≈6016) 이후·구간1 시작(8000-RAMP≈6484) 이전의 중립 구간.
    expect(sampleRecipe(recipe, 6200)).toEqual({ scale: 1, x: 500, y: 400 })
  })

  it('줌인 경계에서 배율이 정확히 안착한다: 시작=1, 끝=2 (스프링, 오버슈트 없음)', () => {
    // 온전한 램프 창을 가진 구간1로 검증. start = 8000-RAMP, fullIn = 8000.
    const start = 8000 - ZOOM_RAMP_MS
    // 시작: springEase(0)=0 → scale 1. scale 1이면 중심은 프레임 중앙으로 클램핑.
    expect(sampleRecipe(recipe, start)).toEqual({ scale: 1, x: 500, y: 400 })

    // 완전 줌인(t=8000): springEase(1)=1 → scale 정확히 2 (스냅으로 경계 정확).
    expect(sampleRecipe(recipe, 8000).scale).toBe(2)

    // 램프 내내 배율은 단조 증가하며 목표(2)를 넘지 않는다(과감쇠 → 오버슈트 없음).
    let prev = 0
    for (let t = start; t <= 8000; t += 20) {
      const s = sampleRecipe(recipe, t).scale
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(s).toBeLessThanOrEqual(2 + 1e-9)
      prev = s
    }
  })

  it('체감 줌인 캘리브레이션: 시작 후 ≈0.5s에 배율이 목표의 90% 이상 도달한다', () => {
    // 과감쇠 스프링은 초반에 대부분 도달(≈0.5s에 ~93%)하고 꼬리만 느리게 붙는다.
    const start = 8000 - ZOOM_RAMP_MS
    const at500 = sampleRecipe(recipe, start + 500).scale
    // scale = 1 + (2-1)*springEase(500/RAMP) ≈ 1.929.
    expect(at500).toBeGreaterThan(1 + (2 - 1) * 0.9)
  })

  it('유지 구간에서 뷰 안 클릭은 카메라를 옮기지 않는다 (issue #4)', () => {
    // 둘째 클릭(420,310)은 뷰 안 → 팬 없음. 유지 내내 중심은 첫 클릭에 머문다.
    expect(sampleRecipe(recipe, 1750)).toEqual({ scale: 2, x: 400, y: 300 })
    expect(sampleRecipe(recipe, 2500)).toEqual({ scale: 2, x: 400, y: 300 })
  })

  it('줌아웃 경계에서 배율이 정확히 안착한다: 시작=2, 끝=1 (스프링, 오버슈트 없음)', () => {
    // 구간0 줌아웃: holdEnd 4500 → end 4500+RAMP. 중심은 유지된 첫 클릭(400,300).
    const end = 4500 + ZOOM_RAMP_MS
    // 줌아웃 시작(t=4500): 아직 완전 줌인.
    expect(sampleRecipe(recipe, 4500)).toEqual({ scale: 2, x: 400, y: 300 })

    // 완전 줌아웃(t=end): springEase(1)=1 → scale 정확히 1, 중심은 프레임 중앙.
    expect(sampleRecipe(recipe, end)).toEqual({ scale: 1, x: 500, y: 400 })

    // 램프 내내 배율은 단조 감소하며 1 미만으로 내려가지 않는다(오버슈트 없음).
    let prev = 2
    for (let t = 4500; t <= end; t += 20) {
      const s = sampleRecipe(recipe, t).scale
      expect(s).toBeLessThanOrEqual(prev + 1e-9)
      expect(s).toBeGreaterThanOrEqual(1 - 1e-9)
      prev = s
    }
  })

  it('중심이 프레임을 벗어나면 가장자리로 클램핑한다 (SPEC 3)', () => {
    // 구간1 클릭 (800,600)은 배율 2에서 우/하단 밖 → x는 750으로 클램핑, y는 경계 600.
    // (가시 뷰 500×400, 중심 허용 범위 x[250,750]·y[200,600])
    const cam = sampleRecipe(recipe, 8000)
    expect(cam.scale).toBe(2)
    expect(cam.x).toBe(750)
    expect(cam.y).toBe(600)
  })

  it('팬 구간은 배율을 유지한 채 카메라 중심만 이동한다 (issue #4)', () => {
    // 뷰 밖 클릭으로 이어진 팬: 1.0s (300,250) → 2.5s (700,550), 배율 2.0 유지.
    const panRecipe = deriveRecipe(loadTrack('event-track-pan.json'), { source })

    const start = sampleRecipe(panRecipe, 1000)
    const mid = sampleRecipe(panRecipe, 1750)
    const end = sampleRecipe(panRecipe, 2500)

    // 배율은 세 지점 모두 완전 줌인(2.0)으로 유지된다 — 줌아웃하지 않는다.
    expect(start.scale).toBe(2)
    expect(mid.scale).toBe(2)
    expect(end.scale).toBe(2)

    // 카메라 중심만 첫 클릭 → 중간 → 둘째 클릭으로 선형 이동한다.
    expect(start.x).toBeCloseTo(300, 10)
    expect(start.y).toBeCloseTo(250, 10)
    expect(mid.x).toBeCloseTo(500, 10)
    expect(mid.y).toBeCloseTo(400, 10)
    expect(end.x).toBeCloseTo(700, 10)
    expect(end.y).toBeCloseTo(550, 10)
  })

  it('샘플링은 구간마다 그 구간의 배율로 램프를 계산한다 (#23)', () => {
    // 구간0은 1.5x, 구간1은 2.5x로 서로 다르게 당긴다.
    const perSegment: typeof recipe = {
      ...recipe,
      zoomSegments: [
        { ...recipe.zoomSegments[0], scale: 1.5 },
        { ...recipe.zoomSegments[1], scale: 2.5 }
      ]
    }
    // 구간0 완전 줌인(t=1000): 배율 1.5.
    expect(sampleRecipe(perSegment, 1000).scale).toBe(1.5)
    // 구간1 완전 줌인(t=8000): 배율 2.5.
    expect(sampleRecipe(perSegment, 8000).scale).toBe(2.5)
  })

  it('구간 배율은 그 구간 기준으로 클램핑된다 (#23)', () => {
    // 구간1 클릭 (800,600). 배율 1.5에서는 가시 뷰가 더 넓어(667×533) 클램핑 경계가 달라진다.
    const perSegment: typeof recipe = {
      ...recipe,
      zoomSegments: [recipe.zoomSegments[0], { ...recipe.zoomSegments[1], scale: 1.5 }]
    }
    const cam = sampleRecipe(perSegment, 8000)
    expect(cam.scale).toBe(1.5)
    // halfW = 1000/1.5/2 ≈ 333.3 → x 상한 1000-333.3 = 666.7; halfH = 800/1.5/2 ≈ 266.7 → y 상한 533.3.
    expect(cam.x).toBeCloseTo(1000 - 1000 / 1.5 / 2, 6)
    expect(cam.y).toBeCloseTo(800 - 800 / 1.5 / 2, 6)
  })
})

describe('스프링 이징: 정규화 진행도 p → 안착 곡선 (결정 #142, t120/f26/m1)', () => {
  it('경계가 정확하다: p≤0 → 0, p≥1 → 1', () => {
    expect(springEase(0)).toBe(0)
    expect(springEase(1)).toBe(1)
    // 범위 밖 입력은 클램핑된다.
    expect(springEase(-0.5)).toBe(0)
    expect(springEase(1.5)).toBe(1)
  })

  it('단조 증가하며 목표(1)를 넘지 않는다 — 과감쇠라 오버슈트가 없다', () => {
    let prev = -1
    let max = 0
    for (let i = 0; i <= 1000; i++) {
      const v = springEase(i / 1000)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      expect(v).toBeLessThanOrEqual(1 + 1e-12)
      prev = v
      if (v > max) max = v
    }
    // 피크가 1을 초과하지 않는다(오버슈트 없음).
    expect(max).toBeLessThanOrEqual(1 + 1e-12)
  })

  it('안착 램프 길이가 스프링 정지 시점으로 정해진다(고정 500ms 폐기)', () => {
    // 과감쇠 안착은 500ms보다 훨씬 길다(고정 램프를 대체). 합리적 상한 안에 든다.
    expect(ZOOM_RAMP_MS).toBeGreaterThan(500)
    expect(ZOOM_RAMP_MS).toBeLessThan(3000)
  })

  it('체감 줌인 ≈0.5s: 램프 시작 후 500ms에 곡선이 90% 이상 도달', () => {
    expect(springEase(500 / ZOOM_RAMP_MS)).toBeGreaterThan(0.9)
  })
})
