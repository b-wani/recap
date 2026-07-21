/**
 * 경량 편집 — 렌더 레시피 변환 함수 모음.
 *
 * 편집이란 렌더 레시피를 고치는 행위다(CONTEXT "렌더 레시피"). 여기 함수들은
 * 모두 순수 함수로, 입력 레시피를 변형하지 않고 새 레시피를 반환한다. 원본 녹화
 * (영상 + 이벤트 트랙)는 이 층에서 절대 건드리지 않는다 — 편집은 파생 데이터인
 * 레시피만 수정한다.
 *
 * 경량 편집의 전부: 줌 구간 삭제/이동/길이 조절, 앞뒤 트리밍(양끝 클립 경계),
 * 컷(분할)·속도 조절. 자막은 계속 제외(SPEC 범위 밖).
 *
 * UI(타임라인)는 사용자 조작을 이 함수 호출로 옮기고 결과를 미리보기에 그리는
 * 얇은 층이다. 편집 규칙과 경계 처리는 전부 이 모듈 안에 있다.
 */

import { nextClipId, SPEED_DEFAULTS, ZOOM_DEFAULTS, type Clip, type RenderRecipe, type ZoomSegment } from './recipe'

/** 줌 구간 시간 앵커의 최소 간격(ms). 이동·길이 조절이 앵커를 뒤엎지 않게 지킨다. */
const MIN_SPAN_MS = 1

/** 클립의 최소 source 길이(ms). 트림·분할이 클립을 0/음수 길이로 만들지 않게 지킨다. */
const MIN_CLIP_MS = 1

/** 지정한 줌 구간을 삭제한다. 원본 녹화는 그대로, 레시피에서 구간만 빠진다. */
export function deleteZoomSegment(recipe: RenderRecipe, index: number): RenderRecipe {
  if (index < 0 || index >= recipe.zoomSegments.length) return recipe
  return {
    ...recipe,
    zoomSegments: recipe.zoomSegments.filter((_, i) => i !== index)
  }
}

/**
 * 줌 구간을 타임라인에서 통째로 이동한다. 네 시간 앵커와 팬 키프레임 시각을 함께
 * deltaMs만큼 민다(내부 구조·팬 타이밍은 보존). 구간 전체가 [0, durationMs] 안에
 * 머물도록 이동량을 클램핑한다.
 */
export function moveZoomSegment(
  recipe: RenderRecipe,
  index: number,
  deltaMs: number
): RenderRecipe {
  const seg = recipe.zoomSegments[index]
  if (!seg) return recipe

  // 구간이 프레임 밖으로 밀려나지 않도록 이동량을 가둔다.
  const shift = clamp(deltaMs, -seg.startMs, recipe.durationMs - seg.endMs)
  if (shift === 0) return recipe

  return replaceSegment(recipe, index, {
    ...seg,
    startMs: seg.startMs + shift,
    fullInAtMs: seg.fullInAtMs + shift,
    holdEndMs: seg.holdEndMs + shift,
    endMs: seg.endMs + shift,
    keyframes: seg.keyframes.map((k) => ({ ...k, t: k.t + shift }))
  })
}

/** 줌 구간 길이 조절이 잡는 가장자리. */
export type ZoomEdge = 'start' | 'end'

/**
 * 줌 구간의 길이를 조절한다 — 타임라인에서 구간의 한쪽 가장자리를 끄는 조작.
 *
 * - `'start'`: 앞 가장자리. `startMs`와 `fullInAtMs`를 함께 이동(줌인 램프 모양 보존).
 *   `startMs >= 0`, `fullInAtMs <= holdEndMs - MIN_SPAN_MS` 범위로 클램핑.
 * - `'end'`: 뒤 가장자리. `holdEndMs`와 `endMs`를 함께 이동(줌아웃 램프 모양 보존).
 *   `endMs <= durationMs`, `holdEndMs >= fullInAtMs + MIN_SPAN_MS` 범위로 클램핑.
 *
 * 팬 키프레임은 그대로 둔다 — 유지 구간이 줄어 키프레임이 밖으로 나가도 팬 보간이
 * 양끝에 고정하므로 안전하다.
 */
export function resizeZoomSegment(
  recipe: RenderRecipe,
  index: number,
  edge: ZoomEdge,
  deltaMs: number
): RenderRecipe {
  const seg = recipe.zoomSegments[index]
  if (!seg) return recipe

  if (edge === 'start') {
    const shift = clamp(deltaMs, -seg.startMs, seg.holdEndMs - MIN_SPAN_MS - seg.fullInAtMs)
    if (shift === 0) return recipe
    return replaceSegment(recipe, index, {
      ...seg,
      startMs: seg.startMs + shift,
      fullInAtMs: seg.fullInAtMs + shift
    })
  }

  const shift = clamp(deltaMs, seg.fullInAtMs + MIN_SPAN_MS - seg.holdEndMs, recipe.durationMs - seg.endMs)
  if (shift === 0) return recipe
  return replaceSegment(recipe, index, {
    ...seg,
    holdEndMs: seg.holdEndMs + shift,
    endMs: seg.endMs + shift
  })
}

/**
 * 지정한 줌 구간의 확대 배율을 바꾼다 — 타임라인에서 구간을 골라 배율을 조절하는 조작.
 *
 * 허용 이산값(ZOOM_DEFAULTS.scales: 1.5/2.0/2.5) 중 가장 가까운 값으로 스냅하고, 그
 * 구간의 시간 앵커·팬 키프레임은 그대로 둔다(배율만 바뀌고 카메라 동선은 유지). 다른
 * 구간과 전역 zoomScale은 건드리지 않는다. 잘못된 index는 무시한다.
 *
 * 팬 키프레임을 재계산하지 않는 것은 resizeZoomSegment가 키프레임을 보존하는 것과 같은
 * 원칙 — 팬 보간이 양끝에 고정하므로 배율이 달라져도 안전하다.
 */
export function setZoomSegmentScale(
  recipe: RenderRecipe,
  index: number,
  scale: number
): RenderRecipe {
  const seg = recipe.zoomSegments[index]
  if (!seg) return recipe
  const snapped = snapScale(scale)
  if (snapped === seg.scale) return recipe
  return replaceSegment(recipe, index, { ...seg, scale: snapped })
}

/** 임의 배율을 허용 이산값 중 가장 가까운 값으로 스냅한다. */
function snapScale(scale: number): number {
  return ZOOM_DEFAULTS.scales.reduce((best, s) =>
    Math.abs(s - scale) < Math.abs(best - scale) ? s : best
  )
}

/** 트림이 잡는 양끝 클립 경계. */
export type ClipEdge = 'start' | 'end'

/**
 * 앞뒤 트리밍 — 양끝 클립의 경계를 옮겨 최종 영상 범위를 정한다(트림은 클립 시퀀스의 양끝
 * 경계로 표현된다, 결정 #144 §2). 원본은 불변이다.
 *
 * - `'start'`: 첫 클립의 `sourceStartMs`를 옮긴다. [0, 첫 클립 끝 - MIN_CLIP_MS] 범위로 클램핑.
 * - `'end'`: 마지막 클립의 `sourceEndMs`를 옮긴다. [마지막 클립 시작 + MIN_CLIP_MS, durationMs] 범위로 클램핑.
 *
 * 이 경계는 outputDurationMs·sourceAtOutput의 입력이 되어 미리보기·익스포트에 반영된다.
 */
export function setClipBoundary(recipe: RenderRecipe, edge: ClipEdge, sourceMs: number): RenderRecipe {
  const clips = recipe.clips
  if (edge === 'start') {
    const first = clips[0]
    const startMs = clamp(sourceMs, 0, first.sourceEndMs - MIN_CLIP_MS)
    if (startMs === first.sourceStartMs) return recipe
    return { ...recipe, clips: clips.map((c, i) => (i === 0 ? { ...c, sourceStartMs: startMs } : c)) }
  }
  const last = clips[clips.length - 1]
  const endMs = clamp(sourceMs, last.sourceStartMs + MIN_CLIP_MS, recipe.durationMs)
  if (endMs === last.sourceEndMs) return recipe
  return {
    ...recipe,
    clips: clips.map((c, i) => (i === clips.length - 1 ? { ...c, sourceEndMs: endMs } : c))
  }
}

/**
 * 컷(분할) — 지정 클립을 source 시각 `atSourceMs`에서 둘로 나눈다(결정 #144 §2·§5). 두 조각은
 * 인접하고(왼쪽 끝 = 오른쪽 시작 = atSourceMs) 원래 속도를 물려받는다. 오른쪽 조각이 새 id를
 * 받아 이후 index가 밀려도 안정 추적된다. 분할점이 클립 안이 아니거나(양끝 포함) 어느 조각이
 * MIN_CLIP_MS보다 짧아지면 무시한다. 이어서 한쪽을 deleteClip하면 그 사이가 컷(간극)이 된다.
 */
export function splitClip(recipe: RenderRecipe, clipId: string, atSourceMs: number): RenderRecipe {
  const idx = recipe.clips.findIndex((c) => c.id === clipId)
  if (idx < 0) return recipe
  const clip = recipe.clips[idx]
  if (atSourceMs <= clip.sourceStartMs + MIN_CLIP_MS || atSourceMs >= clip.sourceEndMs - MIN_CLIP_MS) {
    return recipe
  }
  const left: Clip = { ...clip, sourceEndMs: atSourceMs }
  const right: Clip = {
    id: nextClipId(recipe.clips),
    sourceStartMs: atSourceMs,
    sourceEndMs: clip.sourceEndMs,
    speed: clip.speed
  }
  const clips = [...recipe.clips.slice(0, idx), left, right, ...recipe.clips.slice(idx + 1)]
  return { ...recipe, clips }
}

/**
 * 클립 삭제 — 지정 클립을 시퀀스에서 뺀다(중간 클립을 빼면 그 자리가 컷 간극이 된다). 출력이
 * 사라지지 않도록 마지막 남은 클립 1개는 삭제하지 않는다(무시). 없는 id도 무시한다.
 */
export function deleteClip(recipe: RenderRecipe, clipId: string): RenderRecipe {
  if (recipe.clips.length <= 1) return recipe
  const clips = recipe.clips.filter((c) => c.id !== clipId)
  if (clips.length === recipe.clips.length) return recipe
  return { ...recipe, clips }
}

/**
 * 클립 속도 조절 — 지정 클립의 재생 배율을 바꾼다(결정 #144 §4). 허용 이산값
 * (SPEED_DEFAULTS.speeds) 중 가장 가까운 값으로 스냅한다. 배율은 그 구간의 모든 것(줌·팬·커서·
 * 클릭·키 오버레이)을 함께 압축한다 — source-앵커링이 매핑에서 공짜로 준다(샘플러 불변). 없는
 * id·같은 값은 무시한다.
 */
export function setClipSpeed(recipe: RenderRecipe, clipId: string, speed: number): RenderRecipe {
  const idx = recipe.clips.findIndex((c) => c.id === clipId)
  if (idx < 0) return recipe
  const snapped = snapSpeed(speed)
  if (snapped === recipe.clips[idx].speed) return recipe
  return { ...recipe, clips: recipe.clips.map((c, i) => (i === idx ? { ...c, speed: snapped } : c)) }
}

/** 임의 배속을 허용 이산값 중 가장 가까운 값으로 스냅한다. */
function snapSpeed(speed: number): number {
  return SPEED_DEFAULTS.speeds.reduce((best, s) =>
    Math.abs(s - speed) < Math.abs(best - speed) ? s : best
  )
}

function replaceSegment(recipe: RenderRecipe, index: number, seg: ZoomSegment): RenderRecipe {
  return {
    ...recipe,
    zoomSegments: recipe.zoomSegments.map((s, i) => (i === index ? seg : s))
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
