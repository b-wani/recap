/**
 * 렌더 레시피 파이프라인 — 자동 효과의 순수 코어.
 *
 * 두 단계의 순수 TypeScript 함수 체인이다 (Electron·Canvas·WebCodecs 무의존):
 *
 *  1. 자동 효과 유도  `deriveRecipe(이벤트 트랙) → 렌더 레시피`
 *     클릭 이벤트로부터 줌 구간 목록(팬 키프레임 포함)을 생성한다.
 *  2. 합성 파라미터 샘플링   `sampleComposition(렌더 레시피, 시각 t) → 프레임 합성`
 *     특정 시각의 카메라 변환(줌+팬)·스무딩된 커서·클릭 하이라이트에 더해
 *     배경/패딩·배지까지 합쳐, 미리보기와 익스포트가 공유하는 단일 출력을 낸다.
 *     (`sampleFrame`은 카메라·커서·클릭만, `sampleRecipe`는 카메라 변환만 떼어낸 하위 함수다.)
 *
 * 미리보기·익스포트 렌더링(Canvas)은 sampleComposition의 출력을 그대로 그리기만 하는 얇은 층이다.
 * 효과 계산(줌 이징·팬·커서 스무딩·클릭 하이라이트·배경/패딩·배지)은 전부 이 모듈 안에 있다.
 * 튜닝 수치(배율·이징·타이밍·스무딩 강도·배경/패딩 기본값)는 여기 상수로 모은다.
 */

import type { CaptureTarget, CursorKind, EventTrack, KeySample, MouseSample } from './event-track'

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
  /**
   * 이 구간의 확대 배율. 유도 시 전역 `zoomScale`로 채워지며, 에디터에서 구간마다
   * 달리 조절할 수 있다(1.5/2.0/2.5). 샘플링은 전역이 아닌 이 값으로 램프를 계산한다.
   */
  scale: number
  /** 구간 내 클릭들의 카메라 중심 키프레임 (시간순). 유지 중 이 사이를 팬한다. */
  keyframes: PanKeyframe[]
}

/** 커서 위치 키프레임(원본 px) — 스무딩의 입력이 되는 원본 이벤트 좌표. */
export interface CursorKeyframe {
  t: number
  x: number
  y: number
  cursor: CursorKind
}

/** 클릭(down) 지점 — 클릭 하이라이트의 입력. */
export interface ClickMark {
  t: number
  x: number
  y: number
}

/**
 * 커서 트랙 — 커서 스무딩·클릭 하이라이트의 입력. 이벤트 트랙에서 유도되어 레시피에 담긴다.
 * (원본 이벤트를 그대로 두어, 스무딩 강도는 샘플링 시점에 조절할 수 있게 한다.)
 */
export interface CursorTrack {
  /** 시간순 커서 위치 키프레임 (move·down·up 전부). */
  keyframes: CursorKeyframe[]
  /** 시간순 클릭 지점. */
  clicks: ClickMark[]
}

/**
 * 트림 구간 — 최종 영상으로 남길 원본의 시간 범위(ms). 앞뒤 트리밍은 이 창을 좁힌다.
 * 원본 좌표계 기준이며, 창 밖 구간은 샘플링·미리보기·익스포트에서 제외된다.
 */
export interface Trim {
  startMs: number
  endMs: number
}

/**
 * 배경/패딩 스타일 — 첨부했을 때 보기 좋도록 원본 프레임 둘레에 입히는 여백과 배경.
 * 경량 편집으로 조절하며, 미리보기와 익스포트에 동일하게 반영된다.
 */
export interface BackgroundStyle {
  /** 배경 채우기 색 (CSS color). */
  color: string
  /** 패딩 두께 — 프레임 짧은 변 대비 비율 [0, 0.4]. 0이면 여백 없음. */
  padding: number
}

/**
 * 키스트로크 트랙 + 오버레이 표시 설정 — 이벤트 트랙의 키 로그에서 유도되어 레시피에 담긴다.
 * 오버레이 계산(활성 창·페이드)은 샘플링 시점에 하므로, 여기엔 원본 키와 표시 토글만 둔다.
 */
export interface KeystrokeTrack {
  /** 시간순 키 입력 (단축키·특수키만). */
  keys: KeySample[]
  /** 오버레이 표시 여부. 배지처럼 레시피에 저장되어 미리보기·익스포트에 반영된다. */
  overlayVisible: boolean
}

/** 뷰포트 크기 배지 설정 — 녹화된 화면 크기를 최종 영상 구석에 표시한다. */
export interface BadgeConfig {
  /** 배지 표시 여부. 렌더 레시피에 저장되어 미리보기·익스포트에 반영된다. */
  visible: boolean
  /**
   * 브랜치/커밋 등 맥락 문자열. 에디터에서 자유 입력하며 형식 제약이 없다(예:
   * `feat/v2-overlay @ 61e6fd6`). 빈 문자열이면 맥락 배지를 그리지 않는다. git 자동
   * 읽기·외부 연동 없이 수동 입력만 담는다.
   */
  contextLabel: string
}

/**
 * 렌더 레시피 — 녹화를 최종 영상으로 합성하는 파라미터.
 * 자동 줌 + 팬 + 커서 + 트림 + 배경/패딩·배지를 다룬다.
 */
export interface RenderRecipe {
  source: FrameSize
  /**
   * 논리 뷰포트 크기(포인트) — 배지가 표시하는 "녹화된 화면 크기"(예: 1440×900).
   * source는 캡처 픽셀(Retina 2x)이라 배지 라벨로는 부적절하다. 대상 정보 없이 유도한
   * 레시피(테스트 픽스처)나 v1 저장본에는 없으며, 그 경우 배지는 source로 폴백한다.
   */
  viewport?: FrameSize
  /** 전역 줌 배율 (1 = 확대 없음). */
  zoomScale: number
  durationMs: number
  zoomSegments: ZoomSegment[]
  /** 커서 스무딩·클릭 하이라이트의 입력. */
  cursor: CursorTrack
  /** 최종 영상으로 남길 원본 시간 범위. 기본은 전 구간 [0, durationMs]. */
  trim: Trim
  /** 배경/패딩 스타일. */
  background: BackgroundStyle
  /** 뷰포트 크기 배지 설정. */
  badge: BadgeConfig
  /** 키 입력 오버레이 — 키 트랙과 표시 토글. */
  keystrokes: KeystrokeTrack
}

/** 시각 t에서의 카메라 상태 — 미리보기 층이 그대로 그린다. */
export interface CameraTransform {
  /** 확대 배율 (1 = 원본 그대로). */
  scale: number
  /** 카메라가 화면 중앙에 두는 원본 좌표(px). */
  x: number
  y: number
}

/** 시각 t의 스무딩된 커서 상태(원본 px) — 미리보기 층이 그대로 그린다. */
export interface CursorSample {
  /** 스무딩된 위치(원본 px). 원본 이벤트의 흔들림이 감쇠되어 있다. */
  x: number
  y: number
  /** 시각 t의 커서 모양(스무딩 대상 아님 — 가장 최근 이벤트의 모양). */
  cursor: CursorKind
}

/** 시각 t의 활성 클릭 하이라이트 — 미리보기 층이 리플/눌림으로 그린다. */
export interface ClickHighlight {
  /** 클릭 위치(원본 px). */
  x: number
  y: number
  /** 하이라이트 애니메이션 진행도 0→1 (0 = 클릭 순간). */
  progress: number
}

/**
 * 프레임 샘플 — 시각 t에서 미리보기 층이 그려야 할 카메라·커서·클릭 파라미터.
 * 카메라 변환 + 스무딩된 커서 + (있다면) 클릭 하이라이트.
 */
export interface FrameSample {
  camera: CameraTransform
  /** 커서 이벤트가 없으면 null. */
  cursor: CursorSample | null
  /** 활성 클릭 하이라이트가 없으면 null. */
  click: ClickHighlight | null
}

/** 키 오버레이 샘플링 결과 — 시각 t에 표시할 조합 문자열과 페이드 진행도. */
export interface KeyOverlayState {
  /** 표시할 조합 문자열 (예: "⌘S"). */
  combo: string
  /** 페이드 진행도 0→1 (0 = 방금 눌림, 1 = 사라지기 직전). 그리기 층이 불투명도로 환산. */
  fade: number
}

/** 배지 샘플링 결과 — 표시 여부와 표시할 문자열(라벨). */
export interface BadgeState {
  visible: boolean
  /** 뷰포트 크기 라벨 (예: "1440×900"). 녹화된 화면 크기에서 유도. */
  label: string
  /** 사용자 입력 맥락 문자열(브랜치/커밋 등). 빈 문자열이면 맥락 배지를 그리지 않는다. */
  contextLabel: string
}

/**
 * 시각 t의 합성 파라미터 전체 — 미리보기와 익스포트가 공유하는 단일 샘플링 출력.
 * 카메라·커서·클릭(프레임 샘플)에 더해 배경/패딩·배지를 함께 담아, 두 층이 동일한 프레임을 그린다.
 */
export interface FrameComposition {
  camera: CameraTransform
  /** 커서 이벤트가 없으면 null. */
  cursor: CursorSample | null
  /** 활성 클릭 하이라이트가 없으면 null. */
  click: ClickHighlight | null
  background: BackgroundStyle
  badge: BadgeState
  /** 시각 t에 표시할 키 오버레이. 활성 창 밖이거나 표시 off면 null. */
  keyOverlay: KeyOverlayState | null
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
  /** 선택 가능한 이산 배율 (전역·구간 공통). setZoomSegmentScale이 이 중 가장 가까운 값으로 스냅한다. */
  scales: [1.5, 2.0, 2.5] as readonly number[],
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
 * 커서 튜닝 수치 (SPEC "커서 렌더링"). 규칙만 테스트로 고정하고 값은 실험으로 정한다.
 */
export const CURSOR_DEFAULTS = {
  /**
   * 스무딩 커널의 표준편차(ms). 각 이벤트에 시간 거리 기반 가우시안 가중치를 주어
   * 평균 내므로, 이 값이 클수록 흔들림이 더 강하게 감쇠된다(SPEC: 스무딩 끔/약/강).
   */
  smoothingMs: 120,
  /** 클릭 하이라이트(리플+눌림)가 지속되는 시간(ms). */
  clickHighlightMs: 400
} as const

/**
 * 키 오버레이 튜닝 수치. 규칙만 테스트로 고정하고 값은 실험으로 정한다.
 */
export const KEYSTROKE_DEFAULTS = {
  /** 키 하나가 화면에 떠 있는 시간(ms). 이 창 안이면 오버레이로 표시된다. */
  holdMs: 1200
} as const

/** 배경/패딩·배지 기본값. 유도 시 레시피에 담기고, 경량 편집으로 바뀐다. */
export const COMPOSITE_DEFAULTS = {
  /** 기본 배경색. */
  backgroundColor: '#1c1c1e',
  /** 기본 패딩 비율 (짧은 변의 6%). */
  padding: 0.06,
  /** 배지는 기본으로 켜 둔다. */
  badgeVisible: true,
  /** 맥락 문자열 기본값 — 비어 있음(맥락 배지 숨김). */
  contextLabel: '',
  /** 갓 유도한 레시피는 키 오버레이를 기본으로 켠다(키가 있으면 표시). */
  keyOverlayVisible: true
} as const

/**
 * 이벤트 좌표(포인트)를 원본 픽셀 공간으로 정규화한다. 배율은 source와 대상 논리 크기의
 * 비율(캡처 Retina 배율)이다. target이 없으면(테스트 픽스처) 좌표가 이미 source 공간에
 * 있다고 보고 그대로 둔다.
 */
function scaleSamplesToSource(
  samples: MouseSample[],
  target: CaptureTarget | undefined,
  source: FrameSize
): MouseSample[] {
  if (!target || target.width === 0 || target.height === 0) return samples
  const sx = source.width / target.width
  const sy = source.height / target.height
  if (sx === 1 && sy === 1) return samples
  return samples.map((s) => ({ ...s, x: s.x * sx, y: s.y * sy }))
}

/**
 * 자동 효과 유도: 이벤트 트랙의 클릭(down)으로부터 줌 구간 목록을 만든다.
 * mergeGapMs 이내로 이어지는 클릭들은 한 구간으로 묶여(SPEC 4) 그 사이를 팬한다.
 */
export function deriveRecipe(track: EventTrack, config: DeriveConfig): RenderRecipe {
  const zoomScale = config.zoomScale ?? ZOOM_DEFAULTS.scale
  const source = config.source

  // 이벤트 좌표는 대상의 논리 크기(포인트) 기준인데 source는 캡처 픽셀(Retina 2x)이다.
  // 렌더 파이프라인(카메라·클램프·커서·compose)은 전부 source 공간을 가정하므로,
  // 여기서 포인트→픽셀 배율을 한 번 흡수한다. target이 없는 트랙(픽스처)은 좌표가 이미
  // source 공간에 있다고 보고 배율 1을 쓴다.
  const samples = scaleSamplesToSource(track.samples, track.target, source)

  const clicks = samples
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
      // 유도 시점의 전역 배율을 이 구간의 기본 배율로 삼는다. 이후 에디터에서 구간별로 바꾼다.
      scale: zoomScale,
      keyframes: panKeyframes(group, zoomScale, source)
    })
    group = []
  }

  for (const click of clicks) {
    const prev = group[group.length - 1]
    if (prev && click.t - prev.t > ZOOM_DEFAULTS.mergeGapMs) flush()
    group.push(click)
  }
  flush()

  // 커서 트랙: 모든 이벤트를 시간순 위치 키프레임으로, 클릭은 하이라이트용으로 담는다.
  const keyframes: CursorKeyframe[] = [...samples]
    .sort((a, b) => a.t - b.t)
    .map((s) => ({ t: s.t, x: s.x, y: s.y, cursor: s.cursor }))
  const cursor: CursorTrack = {
    keyframes,
    clicks: clicks.map((c) => ({ t: c.t, x: c.x, y: c.y }))
  }

  return {
    source: { width: source.width, height: source.height },
    // 배지가 표시할 논리 뷰포트 크기(포인트). 대상이 있으면 그 논리 크기를 담는다.
    ...(track.target && {
      viewport: { width: track.target.width, height: track.target.height }
    }),
    zoomScale,
    durationMs: track.durationMs,
    zoomSegments,
    cursor,
    trim: { startMs: 0, endMs: track.durationMs },
    background: {
      color: COMPOSITE_DEFAULTS.backgroundColor,
      padding: COMPOSITE_DEFAULTS.padding
    },
    badge: {
      visible: COMPOSITE_DEFAULTS.badgeVisible,
      contextLabel: COMPOSITE_DEFAULTS.contextLabel
    },
    // 키 입력은 줌을 트리거하지 않는다(마우스 클릭만) — 오버레이 표시용으로만 담는다.
    keystrokes: {
      keys: [...(track.keys ?? [])].sort((a, b) => a.t - b.t),
      overlayVisible: COMPOSITE_DEFAULTS.keyOverlayVisible
    }
  }
}

/**
 * 그룹 내 클릭에서 팬 키프레임만 골라낸다 (팬 연결 규칙).
 *
 * 첫 클릭은 항상 키프레임(줌인 중심)이다. 이후 클릭은 현재 카메라 뷰 밖에 있을 때만
 * 팬으로 잇는다(키프레임 추가) — 줌아웃했다가 다시 줌인하는 대신 배율을 유지한 채 중심만
 * 옮긴다. 뷰 안 클릭은 카메라를 움직이지 않으므로 키프레임을 만들지 않는다(줌 유지).
 * 뷰 판정은 실제로 표시되는 클램핑된 중심을 기준으로 한다.
 */
function panKeyframes(group: MouseSample[], scale: number, source: FrameSize): PanKeyframe[] {
  const first = group[0]
  const keyframes: PanKeyframe[] = [{ t: first.t, x: first.x, y: first.y }]
  let center = clampCenter(first.x, first.y, scale, source)
  for (let i = 1; i < group.length; i++) {
    const c = group[i]
    if (isInsideView(center, c.x, c.y, scale, source)) continue
    keyframes.push({ t: c.t, x: c.x, y: c.y })
    center = clampCenter(c.x, c.y, scale, source)
  }
  return keyframes
}

/**
 * 레시피 샘플링: 시각 t에서의 카메라 변환을 계산한다.
 * 구간 밖이면 원본 그대로(scale 1, 프레임 중앙). 구간 안이면 줌인·유지+팬·줌아웃을
 * 이징으로 잇고, 프레임을 벗어나지 않게 중심을 클램핑한다(SPEC 3).
 */
export function sampleRecipe(recipe: RenderRecipe, t: number): CameraTransform {
  // 트림 창 밖의 시각은 최종 영상에 존재하지 않는다 — 원본 그대로로 되돌린다.
  if (t < recipe.trim.startMs || t > recipe.trim.endMs) return neutral(recipe.source)

  const seg = recipe.zoomSegments.find((s) => t >= s.startMs && t <= s.endMs)
  if (!seg) return neutral(recipe.source)

  let scale: number
  let center: { x: number; y: number }

  if (t < seg.fullInAtMs) {
    // 줌인 ramp: scale 1 → seg.scale, 중심은 첫 클릭.
    const p = seg.fullInAtMs > seg.startMs ? (t - seg.startMs) / (seg.fullInAtMs - seg.startMs) : 1
    scale = 1 + (seg.scale - 1) * ease(p)
    const k = seg.keyframes[0]
    center = { x: k.x, y: k.y }
  } else if (t <= seg.holdEndMs) {
    // 유지: 완전 줌인 상태로 클릭 키프레임 사이를 팬(SPEC 팬).
    scale = seg.scale
    center = panAt(seg.keyframes, t)
  } else {
    // 줌아웃 ramp: scale seg.scale → 1, 중심은 마지막 클릭.
    const p = seg.endMs > seg.holdEndMs ? (t - seg.holdEndMs) / (seg.endMs - seg.holdEndMs) : 1
    scale = 1 + (seg.scale - 1) * (1 - ease(p))
    const k = seg.keyframes[seg.keyframes.length - 1]
    center = { x: k.x, y: k.y }
  }

  return clampCamera(scale, center, recipe.source)
}

/**
 * 프레임 샘플링: 시각 t에서 그려야 할 카메라·커서·클릭 파라미터를 계산한다.
 * 카메라 변환 + 스무딩된 커서 + (있다면) 클릭 하이라이트. 계산은 전부 여기(순수 층)에서 한다.
 */
export function sampleFrame(recipe: RenderRecipe, t: number): FrameSample {
  // 트림 창 밖의 시각은 최종 영상에 존재하지 않는다 — 카메라·커서·클릭 모두 비운다.
  if (t < recipe.trim.startMs || t > recipe.trim.endMs) {
    return { camera: neutral(recipe.source), cursor: null, click: null }
  }
  return {
    camera: sampleRecipe(recipe, t),
    cursor: sampleCursor(recipe.cursor, t),
    click: sampleClick(recipe.cursor, t)
  }
}

/**
 * 합성 파라미터 샘플링: 시각 t에서 프레임 하나를 합성하는 데 필요한 값 전체를 낸다.
 * 프레임 샘플(카메라·커서·클릭, 트림 반영)에 레시피의 배경/패딩·배지를 더한다. 배지
 * 라벨은 논리 뷰포트 크기(viewport, 포인트)에서 유도하므로, 미리보기와 익스포트가 같은
 * 문자열을 그린다. viewport가 없으면(픽스처·v1 저장본) source로 폴백한다.
 */
export function sampleComposition(recipe: RenderRecipe, t: number): FrameComposition {
  const frame = sampleFrame(recipe, t)
  const viewport = recipe.viewport ?? recipe.source
  return {
    camera: frame.camera,
    cursor: frame.cursor,
    click: frame.click,
    background: recipe.background,
    badge: {
      visible: recipe.badge.visible,
      label: `${viewport.width}×${viewport.height}`,
      contextLabel: recipe.badge.contextLabel
    },
    keyOverlay: sampleKeyOverlay(recipe, t)
  }
}

/**
 * 시각 t에 표시할 키 오버레이를 고른다. 표시 off·트림 밖·활성 키 없음이면 null.
 * holdMs 창 안에 든 가장 최근 키를 표시하므로(최근 우선), 연속 키는 겹치지 않고
 * 순서대로 나타난다. 페이드는 창 안 진행도(0→1)로 낸다.
 */
function sampleKeyOverlay(recipe: RenderRecipe, t: number): KeyOverlayState | null {
  const ks = recipe.keystrokes
  if (!ks.overlayVisible) return null
  if (t < recipe.trim.startMs || t > recipe.trim.endMs) return null

  const hold = KEYSTROKE_DEFAULTS.holdMs
  for (let i = ks.keys.length - 1; i >= 0; i--) {
    const k = ks.keys[i]
    if (t >= k.t && t < k.t + hold) {
      return { combo: k.combo, fade: (t - k.t) / hold }
    }
  }
  return null
}

/**
 * 스무딩된 커서: 이벤트 좌표를 시간 거리 기반 가우시안 가중 평균해, 원본의 흔들림을 감쇠한다.
 * 대칭 커널이라 위치가 뒤처지지 않고, 인접한 반대 방향 지터가 서로 상쇄된다.
 */
function sampleCursor(track: CursorTrack, t: number): CursorSample | null {
  const kf = track.keyframes
  if (kf.length === 0) return null

  const sigma = CURSOR_DEFAULTS.smoothingMs
  let sumW = 0
  let sumX = 0
  let sumY = 0
  for (const k of kf) {
    const d = (t - k.t) / sigma
    const w = Math.exp(-0.5 * d * d)
    sumW += w
    sumX += w * k.x
    sumY += w * k.y
  }

  // t가 모든 이벤트에서 극단적으로 멀어 가중치가 언더플로하면 가장 가까운 키프레임으로 대체.
  if (sumW === 0) {
    const near = nearestKeyframe(kf, t)
    return { x: near.x, y: near.y, cursor: cursorKindAt(kf, t) }
  }
  return { x: sumX / sumW, y: sumY / sumW, cursor: cursorKindAt(kf, t) }
}

/** 시각 t의 활성 클릭 하이라이트. clickHighlightMs 창 안에 든 가장 최근 클릭을 고른다. */
function sampleClick(track: CursorTrack, t: number): ClickHighlight | null {
  const dur = CURSOR_DEFAULTS.clickHighlightMs
  for (let i = track.clicks.length - 1; i >= 0; i--) {
    const c = track.clicks[i]
    if (t >= c.t && t < c.t + dur) {
      return { x: c.x, y: c.y, progress: (t - c.t) / dur }
    }
  }
  return null
}

/** 시각 t의 커서 모양 — 모양은 스무딩하지 않고 t 이하 가장 최근 이벤트의 모양을 쓴다. */
function cursorKindAt(kf: CursorKeyframe[], t: number): CursorKind {
  let kind = kf[0].cursor
  for (const k of kf) {
    if (k.t <= t) kind = k.cursor
    else break
  }
  return kind
}

/** 시간상 t에 가장 가까운 키프레임 (가중치 언더플로 시 대체용). */
function nearestKeyframe(kf: CursorKeyframe[], t: number): CursorKeyframe {
  let best = kf[0]
  for (const k of kf) {
    if (Math.abs(k.t - t) < Math.abs(best.t - t)) best = k
  }
  return best
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
  const c = clampCenter(center.x, center.y, scale, source)
  return { scale, x: c.x, y: c.y }
}

/** 확대 뷰가 프레임을 벗어나지 않는 카메라 중심으로 좌표를 가둔다. */
function clampCenter(x: number, y: number, scale: number, source: FrameSize): { x: number; y: number } {
  const halfW = source.width / scale / 2
  const halfH = source.height / scale / 2
  return {
    x: clamp(x, halfW, source.width - halfW),
    y: clamp(y, halfH, source.height - halfH)
  }
}

/**
 * 클릭이 현재 카메라 뷰(배율 scale) 안에 있는지. 뷰는 center를 중심으로 source/scale 크기다.
 * 안이면 팬하지 않고 줌을 유지한다.
 */
function isInsideView(
  center: { x: number; y: number },
  x: number,
  y: number,
  scale: number,
  source: FrameSize
): boolean {
  const halfW = source.width / scale / 2
  const halfH = source.height / scale / 2
  return Math.abs(x - center.x) <= halfW && Math.abs(y - center.y) <= halfH
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
