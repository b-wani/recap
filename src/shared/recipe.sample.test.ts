import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleRecipe } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

// 원본 1000×800, 배율 2.0으로 유도한 레시피를 샘플링한다.
// 구간0: start 500 · fullIn 1000 · holdEnd 4500 · end 5000. 첫 클릭 (400,300);
//        둘째 클릭 (420,310)은 뷰 안이라 팬 없음 → 중심은 (400,300) 유지.
// 구간1: start 7500 · fullIn 8000 · holdEnd 10000 · end 10500, 클릭 (800,600)
const source = { width: 1000, height: 800 }
const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

describe('레시피 샘플링: (렌더 레시피, 시각 t) → 카메라 변환', () => {
  it('줌 구간 밖에서는 원본 그대로(scale 1, 프레임 중앙)', () => {
    expect(sampleRecipe(recipe, 0)).toEqual({ scale: 1, x: 500, y: 400 })
    expect(sampleRecipe(recipe, 6000)).toEqual({ scale: 1, x: 500, y: 400 })
  })

  it('줌인 경계에서 이징 값이 정확하다: 시작=1, 중간=1.5, 끝=2', () => {
    // 시작(t=500): ease(0)=0 → scale 1. scale 1이면 중심은 프레임 중앙으로 클램핑.
    expect(sampleRecipe(recipe, 500)).toEqual({ scale: 1, x: 500, y: 400 })

    // 중간(t=750): ease(0.5)=0.5 → scale 1.5, 중심은 첫 클릭.
    const mid = sampleRecipe(recipe, 750)
    expect(mid.scale).toBeCloseTo(1.5, 10)
    expect(mid.x).toBeCloseTo(400, 10)
    expect(mid.y).toBeCloseTo(300, 10)

    // 끝(t=1000): 완전 줌인 → scale 2, 중심은 첫 클릭.
    expect(sampleRecipe(recipe, 1000)).toEqual({ scale: 2, x: 400, y: 300 })
  })

  it('유지 구간에서 뷰 안 클릭은 카메라를 옮기지 않는다 (issue #4)', () => {
    // 둘째 클릭(420,310)은 뷰 안 → 팬 없음. 유지 내내 중심은 첫 클릭에 머문다.
    expect(sampleRecipe(recipe, 1750)).toEqual({ scale: 2, x: 400, y: 300 })
    expect(sampleRecipe(recipe, 2500)).toEqual({ scale: 2, x: 400, y: 300 })
  })

  it('줌아웃 경계에서 이징 값이 정확하다: 시작=2, 중간=1.5, 끝=1', () => {
    // 줌아웃 시작(t=4500): 아직 완전 줌인, 중심은 유지된 첫 클릭.
    expect(sampleRecipe(recipe, 4500)).toEqual({ scale: 2, x: 400, y: 300 })

    // 중간(t=4750): ease(0.5)=0.5 → scale 1.5.
    const mid = sampleRecipe(recipe, 4750)
    expect(mid.scale).toBeCloseTo(1.5, 10)
    expect(mid.x).toBeCloseTo(400, 10)
    expect(mid.y).toBeCloseTo(300, 10)

    // 끝(t=5000): 완전 줌아웃 → scale 1, 중심은 프레임 중앙.
    expect(sampleRecipe(recipe, 5000)).toEqual({ scale: 1, x: 500, y: 400 })
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
})
