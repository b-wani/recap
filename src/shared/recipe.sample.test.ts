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
// 구간0: start 500 · fullIn 1000 · holdEnd 4500 · end 5000, 클릭 (400,300)→(420,310)
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

  it('유지 구간에서 클릭 사이를 팬한다', () => {
    // 두 클릭 중간(t=1750): (400,300)→(420,310) 선형 절반 = (410,305).
    const panned = sampleRecipe(recipe, 1750)
    expect(panned.scale).toBe(2)
    expect(panned.x).toBeCloseTo(410, 10)
    expect(panned.y).toBeCloseTo(305, 10)

    // 마지막 클릭(t=2500)에서 중심은 그 클릭.
    expect(sampleRecipe(recipe, 2500)).toEqual({ scale: 2, x: 420, y: 310 })
  })

  it('줌아웃 경계에서 이징 값이 정확하다: 시작=2, 중간=1.5, 끝=1', () => {
    // 줌아웃 시작(t=4500): 아직 완전 줌인.
    expect(sampleRecipe(recipe, 4500)).toEqual({ scale: 2, x: 420, y: 310 })

    // 중간(t=4750): ease(0.5)=0.5 → scale 1.5.
    const mid = sampleRecipe(recipe, 4750)
    expect(mid.scale).toBeCloseTo(1.5, 10)
    expect(mid.x).toBeCloseTo(420, 10)
    expect(mid.y).toBeCloseTo(310, 10)

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
})
