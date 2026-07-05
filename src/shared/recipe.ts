/**
 * 렌더 레시피 파이프라인 — 자동 효과의 순수 코어.
 *
 * 두 단계의 순수 TypeScript 함수 체인이다 (Electron·Canvas·WebCodecs 무의존):
 *
 *  1. 자동 효과 유도  `deriveRecipe(이벤트 트랙) → 렌더 레시피`
 *     클릭 이벤트로부터 줌 구간 목록을 생성한다.
 *  2. 레시피 샘플링   `sampleRecipe(렌더 레시피, 시각 t) → 카메라 변환`
 *     특정 시각의 확대 배율·중심을 이징 포함해 계산한다.
 *
 * 미리보기 렌더링(Canvas)은 sampleRecipe의 출력을 그대로 그리기만 하는 얇은 층이다.
 * 효과 계산은 전부 이 모듈 안에 있다. 튜닝 수치(배율·이징·타이밍)는 여기 상수로 모은다.
 */

import type { EventTrack, MouseSample } from './event-track'

/** 원본 프레임 크기(px). 카메라 클램핑의 기준이 된다. */
export interface FrameSize {
  width: number
  height: number
}

/** 타임라인상 한 클릭 지점의 카메라 중심(원본 px). 줌 유지 중 팬 보간의 키프레임. */
export interface PanKeyframe {
  t: number
  x: number
  y: number
}

/**
 * 줌 구간 — 타임라인상 특정 시간 범위에 적용되는 확대 효과 단위.
 * 네 지점으로 확대의 생애를 표현한다: 줌인 시작 → 완전 줌인 → 줌아웃 시작 → 완전 줌아웃.
 */
export interface ZoomSegment {
  /** 줌인이 시작되는 시각 (ms). 첫 클릭 rampInMs 전. */
  startMs: number
  /** 완전 줌인에 도달하는 시각 (ms). 첫 클릭 시각. */
  fullInAtMs: number
  /** 줌아웃이 시작되는 시각 (ms). 마지막 활동 + holdAfterMs. */
  holdEndMs: number
  /** 완전 줌아웃이 끝나는 시각 (ms). */
  endMs: number
  /** 구간 내 클릭들의 카메라 중심 키프레임 (시간순). 유지 중 이 사이를 팬한다. */
  keyframes: PanKeyframe[]
}

/**
 * 렌더 레시피 — 녹화를 최종 영상으로 합성하는 파라미터. 이 슬라이스는 자동 줌만 다룬다.
 * (트림·배경/패딩·커서 설정은 이후 슬라이스에서 이 레시피에 더해진다.)
 */
export interface RenderRecipe {
  source: FrameSize
  /** 전역 줌 배율 (1 = 확대 없음). */
  zoomScale: number
  durationMs: number
  zoomSegments: ZoomSegment[]
}

/** 시각 t에서의 카메라 상태 — 미리보기 층이 그대로 그린다. */
export interface CameraTransform {
  /** 확대 배율 (1 = 원본 그대로). */
  scale: number
  /** 카메라가 화면 중앙에 두는 원본 좌표(px). */
  x: number
  y: number
}

export interface DeriveConfig {
  /** 원본 프레임 크기(px). 미리보기는 로드된 영상 크기를 넣는다. */
  source: FrameSize
  /** 전역 줌 배율. 미지정 시 기본값(2.0x). */
  zoomScale?: number
}

/**
 * 자동 줌 튜닝 수치 (SPEC "자동 줌 규칙"). 규칙만 테스트로 고정하고 값은 실험으로 정한다.
 */
export const ZOOM_DEFAULTS = {
  /** 기본 배율 (SPEC 6: 1.5/2.0/2.5, 기본 2.0). */
  scale: 2.0,
  /** 클릭 rampInMs 전부터 줌인 시작 (SPEC 2: 0.5초 전). */
  rampInMs: 500,
  /** 마지막 활동 holdAfterMs 후 줌아웃 시작 (SPEC 5: 2초 후). */
  holdAfterMs: 2000,
  /** 줌아웃에 걸리는 시간 (튜닝값). */
  rampOutMs: 500,
  /** 클릭 간격이 이 이내면 한 줌 구간으로 병합 (SPEC 4: 3초 이내 줌 유지). */
  mergeGapMs: 3000
} as const

/**
 * 자동 효과 유도: 이벤트 트랙의 클릭(down)으로부터 줌 구간 목록을 만든다.
 * mergeGapMs 이내로 이어지는 클릭들은 한 구간으로 묶여(SPEC 4) 그 사이를 팬한다.
 */
export function deriveRecipe(track: EventTrack, config: DeriveConfig): RenderRecipe {
  const zoomScale = config.zoomScale ?? ZOOM_DEFAULTS.scale

  const clicks = track.samples
    .filter((s): s is MouseSample => s.kind === 'down')
    .sort((a, b) => a.t - b.t)

  const zoomSegments: ZoomSegment[] = []
  let group: MouseSample[] = []

  const flush = (): void => {
    if (group.length === 0) return
    const first = group[0]
    const last = group[group.length - 1]
    zoomSegments.push({
      startMs: Math.max(0, first.t - ZOOM_DEFAULTS.rampInMs),
      fullInAtMs: first.t,
      holdEndMs: last.t + ZOOM_DEFAULTS.holdAfterMs,
      endMs: last.t + ZOOM_DEFAULTS.holdAfterMs + ZOOM_DEFAULTS.rampOutMs,
      keyframes: group.map((c) => ({ t: c.t, x: c.x, y: c.y }))
    })
    group = []
  }

  for (const click of clicks) {
    const prev = group[group.length - 1]
    if (prev && click.t - prev.t > ZOOM_DEFAULTS.mergeGapMs) flush()
    group.push(click)
  }
  flush()

  return {
    source: { width: config.source.width, height: config.source.height },
    zoomScale,
    durationMs: track.durationMs,
    zoomSegments
  }
}

/**
 * 레시피 샘플링: 시각 t에서의 카메라 변환을 계산한다.
 * 구간 밖이면 원본 그대로(scale 1, 프레임 중앙). 구간 안이면 줌인·유지+팬·줌아웃을
 * 이징으로 잇고, 프레임을 벗어나지 않게 중심을 클램핑한다(SPEC 3).
 */
export function sampleRecipe(recipe: RenderRecipe, t: number): CameraTransform {
  const seg = recipe.zoomSegments.find((s) => t >= s.startMs && t <= s.endMs)
  if (!seg) return neutral(recipe.source)

  let scale: number
  let center: { x: number; y: number }

  if (t < seg.fullInAtMs) {
    // 줌인 ramp: scale 1 → zoomScale, 중심은 첫 클릭.
    const p = seg.fullInAtMs > seg.startMs ? (t - seg.startMs) / (seg.fullInAtMs - seg.startMs) : 1
    scale = 1 + (recipe.zoomScale - 1) * ease(p)
    const k = seg.keyframes[0]
    center = { x: k.x, y: k.y }
  } else if (t <= seg.holdEndMs) {
    // 유지: 완전 줌인 상태로 클릭 키프레임 사이를 팬(SPEC 팬).
    scale = recipe.zoomScale
    center = panAt(seg.keyframes, t)
  } else {
    // 줌아웃 ramp: scale zoomScale → 1, 중심은 마지막 클릭.
    const p = seg.endMs > seg.holdEndMs ? (t - seg.holdEndMs) / (seg.endMs - seg.holdEndMs) : 1
    scale = 1 + (recipe.zoomScale - 1) * (1 - ease(p))
    const k = seg.keyframes[seg.keyframes.length - 1]
    center = { x: k.x, y: k.y }
  }

  return clampCamera(scale, center, recipe.source)
}

/** 확대 없음 — 프레임 전체를 중앙에 둔다. */
function neutral(source: FrameSize): CameraTransform {
  return { scale: 1, x: source.width / 2, y: source.height / 2 }
}

/** smoothstep 이징 — 경계(0,1)에서 값이 정확히 0/1이고 기울기가 0이라 부드럽다. */
function ease(p: number): number {
  const c = clamp(p, 0, 1)
  return c * c * (3 - 2 * c)
}

/** 키프레임 사이 카메라 중심을 선형 보간한다. 양끝 밖에서는 끝 키프레임에 고정. */
function panAt(keyframes: PanKeyframe[], t: number): { x: number; y: number } {
  const first = keyframes[0]
  const last = keyframes[keyframes.length - 1]
  if (t <= first.t) return { x: first.x, y: first.y }
  if (t >= last.t) return { x: last.x, y: last.y }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    if (t >= a.t && t <= b.t) {
      const p = (t - a.t) / (b.t - a.t)
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }
    }
  }
  return { x: last.x, y: last.y }
}

/** 확대된 뷰가 원본 프레임을 벗어나지 않도록 중심을 가둔다(SPEC 3 가장자리 클램핑). */
function clampCamera(scale: number, center: { x: number; y: number }, source: FrameSize): CameraTransform {
  const halfW = source.width / scale / 2
  const halfH = source.height / scale / 2
  return {
    scale,
    x: clamp(center.x, halfW, source.width - halfW),
    y: clamp(center.y, halfH, source.height - halfH)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
