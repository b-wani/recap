import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleComposition } from './recipe'
import { serializeRecipe, parseRecipe, RecipeParseError } from './recipe.persist'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

const source = { width: 1000, height: 800 }
const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

describe('레시피 직렬화 왕복: 저장 → 로드 후 동일한 샘플링 출력 (AC4)', () => {
  it('왕복한 레시피가 원본과 구조적으로 같다 (줌·팬·커서·트림·배경/패딩·배지 전부)', () => {
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe)
    // 확장 필드가 실제로 담겨 있어야 왕복이 의미가 있다.
    expect(recipe.cursor.keyframes.length).toBeGreaterThan(0)
    expect(recipe.trim).toEqual({ startMs: 0, endMs: recipe.durationMs })
    expect(typeof recipe.background.color).toBe('string')
    expect(typeof recipe.badge.visible).toBe('boolean')
  })

  it('왕복 후 타임라인 전 구간에서 합성 샘플링 출력이 동일하다 (카메라·커서·클릭·배경·배지)', () => {
    const restored = parseRecipe(serializeRecipe(recipe))
    // 줌인·유지·팬·줌아웃·구간 밖을 모두 지나도록 촘촘히 샘플링한다.
    for (let t = 0; t <= recipe.durationMs; t += 50) {
      expect(sampleComposition(restored, t)).toEqual(sampleComposition(recipe, t))
    }
  })

  it('사용자가 편집한 레시피(줌 삭제·이동, 트림, 배경/패딩, 배지)도 왕복 후 그대로 복원된다', () => {
    const edited = {
      ...recipe,
      zoomScale: 2.5,
      zoomSegments: [recipe.zoomSegments[1]], // 첫 구간 삭제, 둘째만 남김
      trim: { startMs: 500, endMs: recipe.durationMs - 500 }, // 앞뒤 트리밍
      background: { color: '#ff8800', padding: 0.2 }, // 배경색·패딩 변경
      badge: { visible: false } // 배지 끔
    }
    const restored = parseRecipe(serializeRecipe(edited))
    expect(restored).toEqual(edited)
    for (let t = 0; t <= recipe.durationMs; t += 50) {
      expect(sampleComposition(restored, t)).toEqual(sampleComposition(edited, t))
    }
  })
})

describe('레시피 파싱 검증', () => {
  it('JSON이 아니면 던진다', () => {
    expect(() => parseRecipe('not json')).toThrow(RecipeParseError)
  })

  it('포맷 버전이 다르면 던진다', () => {
    expect(() => parseRecipe(JSON.stringify({ formatVersion: 99, recipe }))).toThrow(
      RecipeParseError
    )
  })

  it('필수 필드가 빠지면 던진다', () => {
    const broken = JSON.stringify({ formatVersion: 1, recipe: { source, zoomScale: 2 } })
    expect(() => parseRecipe(broken)).toThrow(RecipeParseError)
  })
})
