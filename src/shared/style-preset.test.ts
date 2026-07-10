import { describe, it, expect } from 'vitest'
import { extractStylePreset, applyStylePreset } from './style-preset'
import type { RenderRecipe } from './recipe'

const recipe: RenderRecipe = {
  source: { width: 1000, height: 800 },
  zoomScale: 2,
  durationMs: 5000,
  zoomSegments: [
    {
      startMs: 500,
      fullInAtMs: 1000,
      holdEndMs: 3000,
      endMs: 3500,
      scale: 2,
      keyframes: [{ t: 1000, x: 400, y: 300 }]
    }
  ],
  cursor: {
    keyframes: [{ t: 1000, x: 400, y: 300, cursor: 'arrow' }],
    clicks: [{ t: 1000, x: 400, y: 300 }],
    size: 1.5,
    smoothingMs: 280
  },
  trim: { startMs: 250, endMs: 4750 },
  background: {
    type: 'gradient',
    color: '#1c1c1e',
    gradient: { angle: 145, stops: ['#2b2b30', '#161618'] },
    padding: 0.12,
    cornerRadius: 20,
    shadow: 0.45
  },
  badge: { visible: true, contextLabel: 'feat/x @ abc123' },
  keystrokes: { keys: [{ t: 100, combo: '⌘S' }], overlayVisible: true }
}

describe('extractStylePreset: 레시피 → 스타일 번들', () => {
  it('배경 전체와 커서 크기·스무딩만 골라낸다', () => {
    const preset = extractStylePreset(recipe, '내 스타일', 'preset-1')
    expect(preset).toEqual({
      id: 'preset-1',
      name: '내 스타일',
      background: recipe.background,
      cursor: { size: 1.5, smoothingMs: 280 }
    })
  })

  it('줌 구간·트림·배지·키 오버레이·커서 키프레임은 담지 않는다', () => {
    const preset = extractStylePreset(recipe, '내 스타일', 'preset-1')
    expect(preset).not.toHaveProperty('zoomSegments')
    expect(preset).not.toHaveProperty('trim')
    expect(preset).not.toHaveProperty('badge')
    expect(preset).not.toHaveProperty('keystrokes')
    expect(preset.cursor).not.toHaveProperty('keyframes')
    expect(preset.cursor).not.toHaveProperty('clicks')
  })
})

describe('applyStylePreset: 프리셋 → 레시피 (스타일 필드만 덮어쓴다)', () => {
  const preset = extractStylePreset(
    {
      ...recipe,
      background: {
        type: 'color',
        color: '#ff0000',
        gradient: { angle: 0, stops: ['#000000', '#ffffff'] },
        padding: 0.2,
        cornerRadius: 4,
        shadow: 0
      },
      cursor: { ...recipe.cursor, size: 2, smoothingMs: 0 }
    },
    '다른 스타일',
    'preset-2'
  )

  it('배경 전체와 커서 size·smoothingMs를 프리셋 값으로 덮어쓴다', () => {
    const next = applyStylePreset(recipe, preset)
    expect(next.background).toEqual(preset.background)
    expect(next.cursor.size).toBe(2)
    expect(next.cursor.smoothingMs).toBe(0)
  })

  it('줌 구간·트림·배지·키 오버레이·커서 키프레임/클릭은 그대로 둔다(불변)', () => {
    const next = applyStylePreset(recipe, preset)
    expect(next.zoomSegments).toBe(recipe.zoomSegments)
    expect(next.trim).toBe(recipe.trim)
    expect(next.badge).toBe(recipe.badge)
    expect(next.keystrokes).toBe(recipe.keystrokes)
    expect(next.cursor.keyframes).toBe(recipe.cursor.keyframes)
    expect(next.cursor.clicks).toBe(recipe.cursor.clicks)
    expect(next.durationMs).toBe(recipe.durationMs)
    expect(next.zoomScale).toBe(recipe.zoomScale)
    expect(next.source).toBe(recipe.source)
  })

  it('원본 레시피를 변형하지 않는다(순수 함수)', () => {
    const before = JSON.parse(JSON.stringify(recipe))
    applyStylePreset(recipe, preset)
    expect(recipe).toEqual(before)
  })
})
