/**
 * 렌더 레시피 직렬화 — 편집 상태를 로컬에 저장하고 다시 여는 왕복 계약.
 *
 * 레시피는 순수 데이터(숫자·배열)라 JSON으로 온전히 직렬화된다. 저장은 이 모듈을
 * 거치고, 로드 시에는 손상된 파일을 조용히 통과시키지 않도록 구조를 검증한다.
 * 왕복(직렬화 → 파싱) 후 sampleRecipe 출력이 동일해야 한다 (recipe.persist.test).
 */

import type { CursorKind } from './event-track'
import type { KeySample } from './event-track'
import { CURSOR_DEFAULTS, GRADIENT_PRESETS } from './recipe'
import type {
  BackgroundStyle,
  BadgeConfig,
  ClickMark,
  CursorKeyframe,
  CursorTrack,
  FrameSize,
  GradientFill,
  KeystrokeTrack,
  PanKeyframe,
  RenderRecipe,
  Trim,
  ZoomSegment
} from './recipe'

/** 구버전 레시피에 그라디언트가 없을 때 채우는 기본값(첫 프리셋). type='color'면 그려지지 않는다. */
const DEFAULT_GRADIENT: GradientFill = GRADIENT_PRESETS[0].gradient

const CURSOR_KINDS: readonly CursorKind[] = ['arrow', 'pointer', 'ibeam']

/** 저장 포맷 버전. 호환 불가능한 레시피 스키마 변경 시 올린다. */
export const RECIPE_FORMAT_VERSION = 1

/** 손상되었거나 스키마를 벗어난 레시피 파일을 파싱할 때 던진다 — 조용히 삼키지 않는다. */
export class RecipeParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecipeParseError'
  }
}

/** 렌더 레시피를 저장용 문자열로 직렬화한다 (버전 태그 포함). */
export function serializeRecipe(recipe: RenderRecipe): string {
  return JSON.stringify({ formatVersion: RECIPE_FORMAT_VERSION, recipe }, null, 2)
}

/**
 * 저장된 문자열을 렌더 레시피로 파싱·검증한다.
 * 구조가 계약을 벗어나면 RecipeParseError를 던진다.
 */
export function parseRecipe(text: string): RenderRecipe {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new RecipeParseError('JSON이 아닌 레시피 파일')
  }
  const doc = asObject(raw, '레시피 파일')
  if (doc.formatVersion !== RECIPE_FORMAT_VERSION) {
    throw new RecipeParseError(
      `레시피 포맷 버전 불일치: 파일 ${String(doc.formatVersion)}, 앱 ${RECIPE_FORMAT_VERSION}`
    )
  }
  return validateRecipe(doc.recipe)
}

function validateRecipe(raw: unknown): RenderRecipe {
  const r = asObject(raw, 'recipe')
  const source = asObject(r.source, 'recipe.source')
  if (!isNum(source.width) || !isNum(source.height)) {
    throw new RecipeParseError('recipe.source: width/height 누락')
  }
  if (!isNum(r.zoomScale)) throw new RecipeParseError('recipe.zoomScale 누락')
  if (!isNum(r.durationMs)) throw new RecipeParseError('recipe.durationMs 누락')
  if (!Array.isArray(r.zoomSegments)) throw new RecipeParseError('recipe.zoomSegments 누락')

  return {
    source: { width: source.width, height: source.height },
    // 논리 뷰포트(포인트)는 선택적 — v1 저장본엔 없다. 있으면 검증해 보존한다.
    ...(r.viewport !== undefined && { viewport: validateViewport(r.viewport) }),
    zoomScale: r.zoomScale,
    durationMs: r.durationMs,
    // v1 레시피는 구간 배율이 없다 — 저장된 전역 배율로 채운다(스토리 25).
    zoomSegments: r.zoomSegments.map((s) => validateSegment(s, r.zoomScale as number)),
    cursor: validateCursor(r.cursor),
    trim: validateTrim(r.trim),
    background: validateBackground(r.background),
    badge: validateBadge(r.badge),
    keystrokes: validateKeystrokes(r.keystrokes)
  }
}

/**
 * 키스트로크 트랙을 검증한다. v1/v2 레시피는 키 트랙이 없다 — 빈 키·토글 off로 채운다
 * (스토리: v1 레시피는 토글 off·키 트랙 없음으로 정상 로드).
 */
function validateKeystrokes(raw: unknown): KeystrokeTrack {
  if (raw === undefined || raw === null) return { keys: [], overlayVisible: false }
  const k = asObject(raw, 'recipe.keystrokes')
  if (typeof k.overlayVisible !== 'boolean') {
    throw new RecipeParseError('recipe.keystrokes.overlayVisible 누락')
  }
  if (!Array.isArray(k.keys)) throw new RecipeParseError('recipe.keystrokes.keys 누락')
  return { keys: k.keys.map(validateKeySample), overlayVisible: k.overlayVisible }
}

function validateKeySample(raw: unknown): KeySample {
  const s = asObject(raw, 'keySample')
  if (!isNum(s.t)) throw new RecipeParseError('keySample: t 누락')
  if (typeof s.combo !== 'string' || s.combo.length === 0) {
    throw new RecipeParseError('keySample: combo 누락')
  }
  return { t: s.t, combo: s.combo }
}

function validateCursor(raw: unknown): CursorTrack {
  const c = asObject(raw, 'recipe.cursor')
  if (!Array.isArray(c.keyframes)) throw new RecipeParseError('recipe.cursor.keyframes 누락')
  if (!Array.isArray(c.clicks)) throw new RecipeParseError('recipe.cursor.clicks 누락')
  // v1~v3 레시피는 커서 크기·스무딩 강도가 없다 — 기본값(크기 1x·약)으로 채운다(#35).
  return {
    keyframes: c.keyframes.map(validateCursorKeyframe),
    clicks: c.clicks.map(validateClickMark),
    size: isNum(c.size) ? c.size : CURSOR_DEFAULTS.size,
    smoothingMs: isNum(c.smoothingMs) ? c.smoothingMs : CURSOR_DEFAULTS.smoothingMs
  }
}

function validateCursorKeyframe(raw: unknown): CursorKeyframe {
  const k = asObject(raw, 'cursorKeyframe')
  if (!isNum(k.t) || !isNum(k.x) || !isNum(k.y)) {
    throw new RecipeParseError('cursorKeyframe: t/x/y 누락')
  }
  if (!isCursorKind(k.cursor)) throw new RecipeParseError('cursorKeyframe: cursor 종류 불명')
  return { t: k.t, x: k.x, y: k.y, cursor: k.cursor }
}

function validateClickMark(raw: unknown): ClickMark {
  const c = asObject(raw, 'clickMark')
  if (!isNum(c.t) || !isNum(c.x) || !isNum(c.y)) {
    throw new RecipeParseError('clickMark: t/x/y 누락')
  }
  return { t: c.t, x: c.x, y: c.y }
}

function validateViewport(raw: unknown): FrameSize {
  const v = asObject(raw, 'recipe.viewport')
  if (!isNum(v.width) || !isNum(v.height)) {
    throw new RecipeParseError('recipe.viewport: width/height 누락')
  }
  return { width: v.width, height: v.height }
}

function validateTrim(raw: unknown): Trim {
  const t = asObject(raw, 'recipe.trim')
  if (!isNum(t.startMs) || !isNum(t.endMs)) throw new RecipeParseError('recipe.trim: startMs/endMs 누락')
  return { startMs: t.startMs, endMs: t.endMs }
}

/**
 * 배경 스타일을 검증한다. 구버전 레시피(#36 이전)엔 type·gradient·cornerRadius·shadow가
 * 없다 — 구버전 녹화는 기존 모습을 유지해야 하므로 신규 폴리싱 기본값이 아니라 "옛 모습"
 * 기본값(단색 그대로 · 라운딩 0 · 섀도 off)으로 채운다. 신규 폴리싱 기본값은 deriveRecipe만
 * 부여한다.
 */
function validateBackground(raw: unknown): BackgroundStyle {
  const b = asObject(raw, 'recipe.background')
  if (typeof b.color !== 'string') throw new RecipeParseError('recipe.background.color 누락')
  if (!isNum(b.padding)) throw new RecipeParseError('recipe.background.padding 누락')
  return {
    // 구버전엔 종류 개념이 없다 — 단색으로 봐 기존 색을 그대로 유지한다.
    type: b.type === 'gradient' ? 'gradient' : 'color',
    color: b.color,
    gradient: validateGradient(b.gradient),
    padding: b.padding,
    // 구버전은 각진 모서리·섀도 없음이 기존 모습이다.
    cornerRadius: isNum(b.cornerRadius) ? b.cornerRadius : 0,
    shadow: isNum(b.shadow) ? b.shadow : 0
  }
}

/** 그라디언트를 검증한다. 없으면(구버전) 기본 프리셋으로 채운다 — type='color'면 그려지지 않는다. */
function validateGradient(raw: unknown): GradientFill {
  if (raw === undefined || raw === null) return DEFAULT_GRADIENT
  const g = asObject(raw, 'recipe.background.gradient')
  if (!isNum(g.angle)) throw new RecipeParseError('recipe.background.gradient.angle 누락')
  if (!Array.isArray(g.stops) || g.stops.length !== 2 || !g.stops.every((s) => typeof s === 'string')) {
    throw new RecipeParseError('recipe.background.gradient.stops: 색 정지점 2개 필요')
  }
  return { angle: g.angle, stops: [g.stops[0], g.stops[1]] }
}

function validateBadge(raw: unknown): BadgeConfig {
  const b = asObject(raw, 'recipe.badge')
  if (typeof b.visible !== 'boolean') throw new RecipeParseError('recipe.badge.visible 누락')
  // v1 레시피는 맥락 문자열이 없다 — 빈 문자열로 채운다.
  return { visible: b.visible, contextLabel: typeof b.contextLabel === 'string' ? b.contextLabel : '' }
}

function isCursorKind(v: unknown): v is CursorKind {
  return typeof v === 'string' && (CURSOR_KINDS as readonly string[]).includes(v)
}

function validateSegment(raw: unknown, defaultScale: number): ZoomSegment {
  const s = asObject(raw, 'zoomSegment')
  if (!isNum(s.startMs) || !isNum(s.fullInAtMs) || !isNum(s.holdEndMs) || !isNum(s.endMs)) {
    throw new RecipeParseError('zoomSegment: 시간 지점 누락')
  }
  if (!Array.isArray(s.keyframes)) throw new RecipeParseError('zoomSegment.keyframes 누락')
  return {
    startMs: s.startMs,
    fullInAtMs: s.fullInAtMs,
    holdEndMs: s.holdEndMs,
    endMs: s.endMs,
    // 구간 배율이 없으면(v1) 전역 배율로 채운다.
    scale: isNum(s.scale) ? s.scale : defaultScale,
    keyframes: s.keyframes.map(validateKeyframe)
  }
}

function validateKeyframe(raw: unknown): PanKeyframe {
  const k = asObject(raw, 'keyframe')
  if (!isNum(k.t) || !isNum(k.x) || !isNum(k.y)) {
    throw new RecipeParseError('keyframe: t/x/y 누락')
  }
  return { t: k.t, x: k.x, y: k.y }
}

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) {
    throw new RecipeParseError(`${what}: 객체가 아님`)
  }
  return v as Record<string, unknown>
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
