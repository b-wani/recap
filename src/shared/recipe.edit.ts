/**
 * 경량 편집 — 렌더 레시피 변환 함수 모음.
 *
 * 편집이란 렌더 레시피를 고치는 행위다(CONTEXT "렌더 레시피"). 여기 함수들은
 * 모두 순수 함수로, 입력 레시피를 변형하지 않고 새 레시피를 반환한다. 원본 녹화
 * (영상 + 이벤트 트랙)는 이 층에서 절대 건드리지 않는다 — 편집은 파생 데이터인
 * 레시피만 수정한다.
 *
 * v1 경량 편집의 전부: 줌 구간 삭제/이동/길이 조절, 앞뒤 트리밍.
 * 컷 편집(중간 잘라내기)·속도 조절·자막은 여기에 함수가 없다(SPEC 범위 제외).
 *
 * UI(타임라인)는 사용자 조작을 이 함수 호출로 옮기고 결과를 미리보기에 그리는
 * 얇은 층이다. 편집 규칙과 경계 처리는 전부 이 모듈 안에 있다.
 */

import { ZOOM_DEFAULTS, type RenderRecipe, type Trim, type ZoomSegment } from './recipe'

/** 줌 구간 시간 앵커의 최소 간격(ms). 이동·길이 조절이 앵커를 뒤엎지 않게 지킨다. */
const MIN_SPAN_MS = 1

/** 트림 창의 최소 길이(ms). 앞뒤 트림이 서로 지나쳐 창이 사라지는 것을 막는다. */
const MIN_TRIM_MS = 1

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

/**
 * 앞뒤 트리밍 — 최종 영상으로 남길 원본 시간 창을 정한다. 원본은 불변이고 트림 창만
 * 좁아진다. 창은 [0, durationMs] 안에 있어야 하고 startMs < endMs를 지킨다(최소
 * MIN_TRIM_MS 길이 보장). 이 창은 sampleRecipe가 읽어 미리보기·익스포트에 반영된다.
 */
export function trimRecipe(recipe: RenderRecipe, next: Partial<Trim>): RenderRecipe {
  const endMs = clamp(next.endMs ?? recipe.trim.endMs, MIN_TRIM_MS, recipe.durationMs)
  const startMs = clamp(next.startMs ?? recipe.trim.startMs, 0, endMs - MIN_TRIM_MS)
  return { ...recipe, trim: { startMs, endMs } }
}

/** 트림이 반영된 최종 영상 길이(ms). 미리보기 재생 창·익스포트 길이에 쓴다. */
export function trimmedDurationMs(recipe: RenderRecipe): number {
  return recipe.trim.endMs - recipe.trim.startMs
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
