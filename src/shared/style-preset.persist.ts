/**
 * 스타일 프리셋 직렬화 — 앱 전역 저장소(userData)의 왕복 계약(#77).
 *
 * 프리셋 목록은 순수 데이터라 JSON으로 온전히 직렬화된다. recipe.persist(녹화별)와 달리
 * 목록 파일 하나에 여러 프리셋을 담으므로, 손상된 항목 하나가 목록 전체를 막지 않도록
 * 항목 단위로 걸러낸다(형식이 다르거나 통째로 손상됐으면 빈 목록).
 */

import type { BackgroundStyle, GradientFill } from './recipe'
import type { PresetCursorStyle, StylePreset } from './style-preset'

/** 저장 포맷 버전. 호환 불가능한 프리셋 스키마 변경 시 올린다. */
export const PRESET_FORMAT_VERSION = 1

/** 프리셋 목록을 저장용 문자열로 직렬화한다(버전 태그 포함). */
export function serializePresets(presets: StylePreset[]): string {
  return JSON.stringify({ formatVersion: PRESET_FORMAT_VERSION, presets }, null, 2)
}

/**
 * 저장된 문자열을 프리셋 목록으로 파싱한다. JSON이 아니거나 포맷 버전이 다르거나
 * `presets`가 배열이 아니면 빈 목록을 돌려준다. 목록 안 개별 항목이 손상되면 그
 * 항목만 건너뛰고 나머지는 살린다(재시작 후 목록이 통째로 사라지지 않도록).
 */
export function parsePresets(text: string): StylePreset[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof raw !== 'object' || raw === null) return []
  const doc = raw as Record<string, unknown>
  if (doc.formatVersion !== PRESET_FORMAT_VERSION || !Array.isArray(doc.presets)) return []
  const result: StylePreset[] = []
  for (const item of doc.presets) {
    const preset = validatePreset(item)
    if (preset) result.push(preset)
  }
  return result
}

function validatePreset(raw: unknown): StylePreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return null
  const background = validateBackground(p.background)
  const cursor = validateCursor(p.cursor)
  if (!background || !cursor) return null
  return { id: p.id, name: p.name, background, cursor }
}

function validateBackground(raw: unknown): BackgroundStyle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  if (b.type !== 'color' && b.type !== 'gradient') return null
  if (typeof b.color !== 'string') return null
  if (typeof b.padding !== 'number') return null
  if (typeof b.cornerRadius !== 'number') return null
  if (typeof b.shadow !== 'number') return null
  const gradient = validateGradient(b.gradient)
  if (!gradient) return null
  return {
    type: b.type,
    color: b.color,
    gradient,
    padding: b.padding,
    cornerRadius: b.cornerRadius,
    shadow: b.shadow
  }
}

function validateGradient(raw: unknown): GradientFill | null {
  if (typeof raw !== 'object' || raw === null) return null
  const g = raw as Record<string, unknown>
  if (typeof g.angle !== 'number') return null
  if (!Array.isArray(g.stops) || g.stops.length !== 2 || !g.stops.every((s) => typeof s === 'string')) {
    return null
  }
  return { angle: g.angle, stops: [g.stops[0], g.stops[1]] }
}

function validateCursor(raw: unknown): PresetCursorStyle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (typeof c.size !== 'number' || typeof c.smoothingMs !== 'number') return null
  return { size: c.size, smoothingMs: c.smoothingMs }
}
