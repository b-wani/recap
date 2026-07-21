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
  it('왕복한 레시피가 원본과 구조적으로 같다 (줌·팬·커서·클립·배경/패딩·배지 전부)', () => {
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe)
    // 확장 필드가 실제로 담겨 있어야 왕복이 의미가 있다.
    expect(recipe.cursor.keyframes.length).toBeGreaterThan(0)
    expect(recipe.clips).toEqual([{ id: 'c1', sourceStartMs: 0, sourceEndMs: recipe.durationMs, speed: 1 }])
    expect(typeof recipe.background.color).toBe('string')
    expect(typeof recipe.badge.visible).toBe('boolean')
  })

  it('논리 뷰포트(target 유래)가 왕복 후 보존되어 배지 라벨이 유지된다', () => {
    const track: EventTrack = {
      protocolVersion: 3,
      startedAt: 0,
      durationMs: 4000,
      target: { kind: 'display', id: 'display:1', title: '전체 화면', width: 1440, height: 900 },
      samples: [{ t: 1000, kind: 'down', x: 1400, y: 850, cursor: 'pointer' }]
    }
    const withViewport = deriveRecipe(track, { source: { width: 2880, height: 1800 } })
    const restored = parseRecipe(serializeRecipe(withViewport))
    expect(restored.viewport).toEqual({ width: 1440, height: 900 })
    expect(sampleComposition(restored, 0).badge.label).toBe('1440×900')
  })

  it('왕복 후 타임라인 전 구간에서 합성 샘플링 출력이 동일하다 (카메라·커서·클릭·배경·배지)', () => {
    const restored = parseRecipe(serializeRecipe(recipe))
    // 줌인·유지·팬·줌아웃·구간 밖을 모두 지나도록 촘촘히 샘플링한다.
    for (let t = 0; t <= recipe.durationMs; t += 50) {
      expect(sampleComposition(restored, t)).toEqual(sampleComposition(recipe, t))
    }
  })

  it('사용자가 편집한 레시피(줌 삭제·이동, 컷·속도, 배경/패딩, 배지)도 왕복 후 그대로 복원된다', () => {
    const edited = {
      ...recipe,
      zoomScale: 2.5,
      zoomSegments: [recipe.zoomSegments[1]], // 첫 구간 삭제, 둘째만 남김
      // 앞뒤 트리밍 + 컷(간극) + 속도 — 클립 시퀀스로 표현.
      clips: [
        { id: 'c1', sourceStartMs: 500, sourceEndMs: 3000, speed: 1 },
        { id: 'c2', sourceStartMs: 6000, sourceEndMs: recipe.durationMs - 500, speed: 2 }
      ],
      background: {
        type: 'color' as const,
        color: '#ff8800',
        gradient: recipe.background.gradient,
        padding: 0.2,
        cornerRadius: 18,
        shadow: 0.5
      }, // 배경색·패딩·라운딩·섀도 변경
      badge: { visible: false, contextLabel: 'feat/v2 @ abc123' } // 배지 끔·맥락 입력
    }
    const restored = parseRecipe(serializeRecipe(edited))
    expect(restored).toEqual(edited)
    for (let t = 0; t <= recipe.durationMs; t += 50) {
      expect(sampleComposition(restored, t)).toEqual(sampleComposition(edited, t))
    }
  })
})

describe('v1 레시피 하위호환: 구간 배율 (#23)', () => {
  it('구간 배율이 없는 v1 레시피를 로드하면 저장된 전역 배율로 채워진다 (스토리 25)', () => {
    // v1 형태 — zoomSegments에 scale 필드가 없다.
    const v1 = {
      formatVersion: 1,
      recipe: {
        source,
        zoomScale: 2.5,
        durationMs: 5000,
        zoomSegments: [
          { startMs: 500, fullInAtMs: 1000, holdEndMs: 3000, endMs: 3500, keyframes: [{ t: 1000, x: 400, y: 300 }] }
        ],
        cursor: { keyframes: [{ t: 1000, x: 400, y: 300, cursor: 'pointer' }], clicks: [] },
        trim: { startMs: 0, endMs: 5000 },
        background: { color: '#1c1c1e', padding: 0.06 },
        badge: { visible: true }
      }
    }
    const restored = parseRecipe(JSON.stringify(v1))
    // 구간 배율이 전역 배율(2.5)로 채워진다.
    expect(restored.zoomSegments[0].scale).toBe(2.5)
  })

  it('저장된 구간 배율이 왕복 후 그대로 복원된다', () => {
    const perSegment = {
      ...recipe,
      zoomSegments: recipe.zoomSegments.map((s, i) => ({ ...s, scale: i === 0 ? 1.5 : 2.5 }))
    }
    const restored = parseRecipe(serializeRecipe(perSegment))
    expect(restored.zoomSegments.map((s) => s.scale)).toEqual([1.5, 2.5])
    expect(restored).toEqual(perSegment)
  })
})

describe('v1 레시피 하위호환: 맥락 배지 (#24)', () => {
  it('맥락 문자열이 없는 v1 레시피를 로드하면 빈 값으로 채워진다', () => {
    const v1 = {
      formatVersion: 1,
      recipe: {
        source,
        zoomScale: 2,
        durationMs: 5000,
        zoomSegments: [],
        cursor: { keyframes: [], clicks: [] },
        trim: { startMs: 0, endMs: 5000 },
        background: { color: '#1c1c1e', padding: 0.06 },
        badge: { visible: true } // v1 — contextLabel 없음
      }
    }
    const restored = parseRecipe(JSON.stringify(v1))
    expect(restored.badge).toEqual({ visible: true, contextLabel: '' })
  })

  it('저장된 맥락 문자열이 왕복 후 그대로 복원된다', () => {
    const withContext = { ...recipe, badge: { ...recipe.badge, contextLabel: 'feat/v2 @ abc123' } }
    const restored = parseRecipe(serializeRecipe(withContext))
    expect(restored.badge.contextLabel).toBe('feat/v2 @ abc123')
    expect(restored).toEqual(withContext)
  })
})

describe('v1 레시피 하위호환: 키 오버레이 (#25)', () => {
  it('키스트로크 트랙이 없는 v1 레시피를 로드하면 토글 off·빈 키 트랙으로 채워진다', () => {
    const v1 = {
      formatVersion: 1,
      recipe: {
        source,
        zoomScale: 2,
        durationMs: 5000,
        zoomSegments: [],
        cursor: { keyframes: [], clicks: [] },
        trim: { startMs: 0, endMs: 5000 },
        background: { color: '#1c1c1e', padding: 0.06 },
        badge: { visible: true }
        // keystrokes 없음 (v1)
      }
    }
    const restored = parseRecipe(JSON.stringify(v1))
    expect(restored.keystrokes).toEqual({ keys: [], overlayVisible: false })
  })

  it('저장된 키 트랙·토글이 왕복 후 그대로 복원된다', () => {
    const withKeys = {
      ...recipe,
      keystrokes: {
        keys: [
          { t: 800, combo: '⌘S' },
          { t: 1600, combo: '⌥⌘I' }
        ],
        overlayVisible: true
      }
    }
    const restored = parseRecipe(serializeRecipe(withKeys))
    expect(restored.keystrokes).toEqual(withKeys.keystrokes)
    expect(restored).toEqual(withKeys)
  })

  it('키 combo가 빈 문자열이면 파싱을 거부한다', () => {
    const broken = {
      ...recipe,
      keystrokes: { keys: [{ t: 100, combo: '' }], overlayVisible: true }
    }
    expect(() => parseRecipe(serializeRecipe(broken))).toThrow(RecipeParseError)
  })
})

describe('구버전 레시피 하위호환: 커서 크기·스무딩 (#35)', () => {
  it('커서 크기·스무딩이 없는 구버전 레시피를 로드하면 기본값(크기 1·약)으로 채워진다', () => {
    const old = {
      formatVersion: 1,
      recipe: {
        source,
        zoomScale: 2,
        durationMs: 5000,
        zoomSegments: [],
        cursor: { keyframes: [], clicks: [] }, // size·smoothingMs 없음
        trim: { startMs: 0, endMs: 5000 },
        background: { color: '#1c1c1e', padding: 0.06 },
        badge: { visible: true }
      }
    }
    const restored = parseRecipe(JSON.stringify(old))
    expect(restored.cursor.size).toBe(1)
    expect(restored.cursor.smoothingMs).toBe(120)
  })

  it('저장된 커서 크기·스무딩이 왕복 후 그대로 복원된다', () => {
    const tuned = {
      ...recipe,
      cursor: { ...recipe.cursor, size: 2, smoothingMs: 0 }
    }
    const restored = parseRecipe(serializeRecipe(tuned))
    expect(restored.cursor.size).toBe(2)
    expect(restored.cursor.smoothingMs).toBe(0)
    expect(restored).toEqual(tuned)
  })
})

describe('구버전 레시피 하위호환: 배경 폴리싱 (#36)', () => {
  it('type·gradient·cornerRadius·shadow가 없는 구버전 레시피는 기존 모습으로 로드된다 (단색·라운딩0·섀도off)', () => {
    const old = {
      formatVersion: 1,
      recipe: {
        source,
        zoomScale: 2,
        durationMs: 5000,
        zoomSegments: [],
        cursor: { keyframes: [], clicks: [] },
        trim: { startMs: 0, endMs: 5000 },
        // 구버전 배경 — color·padding만.
        background: { color: '#1c1c1e', padding: 0.06 },
        badge: { visible: true }
      }
    }
    const restored = parseRecipe(JSON.stringify(old))
    // 신규 폴리싱 기본값이 아니라 "옛 모습"을 유지해야 한다.
    expect(restored.background.type).toBe('color')
    expect(restored.background.color).toBe('#1c1c1e')
    expect(restored.background.padding).toBe(0.06)
    expect(restored.background.cornerRadius).toBe(0)
    expect(restored.background.shadow).toBe(0)
    // 그라디언트는 채워지지만 type='color'라 그려지지 않는다.
    expect(restored.background.gradient.stops).toHaveLength(2)
  })

  it('신규 유도 레시피(deriveRecipe)는 폴리싱 기본값을 받는다 (그라디언트·패딩8%·라운딩12·섀도on)', () => {
    // recipe는 파일 상단에서 deriveRecipe로 만든 신규 레시피다.
    expect(recipe.background.type).toBe('gradient')
    expect(recipe.background.padding).toBe(0.08)
    expect(recipe.background.cornerRadius).toBe(12)
    expect(recipe.background.shadow).toBeGreaterThan(0)
  })

  it('저장된 그라디언트·라운딩·섀도가 왕복 후 그대로 복원된다', () => {
    const tuned = {
      ...recipe,
      background: {
        ...recipe.background,
        type: 'gradient' as const,
        gradient: { angle: 90, stops: ['#123456', '#654321'] as [string, string] },
        cornerRadius: 24,
        shadow: 0.7
      }
    }
    const restored = parseRecipe(serializeRecipe(tuned))
    expect(restored.background).toEqual(tuned.background)
    expect(restored).toEqual(tuned)
  })

  it('그라디언트 정지점이 2개가 아니면 파싱을 거부한다', () => {
    const broken = {
      ...recipe,
      background: { ...recipe.background, gradient: { angle: 0, stops: ['#111111'] } }
    }
    expect(() => parseRecipe(JSON.stringify({ formatVersion: 1, recipe: broken }))).toThrow(
      RecipeParseError
    )
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
