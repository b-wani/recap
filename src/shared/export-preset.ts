/**
 * 익스포트 프리셋 — 포맷-우선 export 패널(#159)의 순수 정책·매핑 층.
 *
 * Screen Studio 실측 패널을 모작한다: 포맷 토글(MP4/GIF) + Output Size + Frame rate +
 * Quality 4티어(Studio / Social Media / Web / Web (Low)). 목적지-우선 모델은 폐기했다(#146).
 *
 * 세 축을 분리한다:
 *  - 메뉴(포맷별 허용 해상도·프레임레이트) = 모듈 상수 + `*ForFormat` 게이팅 함수,
 *  - 정책(티어→인코더 파라미터: MP4=QP, GIF=색 수+디더) = 티어 매핑 테이블,
 *  - 선택(해상도·fps·티어) = `ExportSelection` 명시 인자.
 *
 * 순수 TypeScript(Electron·WebCodecs·mediabunny 무의존)라 미리보기·익스포트·테스트가 함께 쓴다.
 * 인코딩 층(renderer/export.ts)은 여기서 계산한 Mp4Config/GifConfig만 소비하고, QP→mediabunny
 * Quality 매핑처럼 인코더 SDK에 의존하는 변환만 자기 쪽에서 한다.
 */

import type { FrameSize } from './recipe'

/**
 * 익스포트 출력 포맷 — ADR 0003이 지운 포맷 차원을 되살린 것(#155·결정 #141).
 * export는 이 값으로 인코더를 분기한다(GIF=gifenc, MP4=WebCodecs+mediabunny). 합성은 공유.
 */
export type ExportFormat = 'gif' | 'mp4'

/** 포맷별 파일 확장자 — main의 `export.{ext}` 저장에 쓴다(확장자 = 포맷 문자열). */
export function extensionForFormat(format: ExportFormat): ExportFormat {
  return format
}

/**
 * 압축 품질 티어 — Screen Studio 4티어를 문자 그대로 재현(#146). 포맷과 독립한 축이라
 * MP4·GIF가 같은 UI 스켈레톤을 쓰되, 티어→인코더 파라미터 매핑만 포맷별로 다르다.
 */
export type QualityTier = 'studio' | 'social' | 'web' | 'web-low'

/** 티어 세그먼트 순서(UI 나열 순서와 동일). */
export const QUALITY_TIERS: QualityTier[] = ['studio', 'social', 'web', 'web-low']

/** 티어 표기 라벨 — SS 문자 그대로. */
export const TIER_LABELS: Record<QualityTier, string> = {
  studio: 'Studio',
  social: 'Social Media',
  web: 'Web',
  'web-low': 'Web (Low)'
}

/**
 * 선택된 티어의 설명문(SS 패널 하단). 포맷마다 의미가 달라(MP4=QP, GIF=색 수+디더) 포맷별로 갈린다.
 * GIF Studio만 "밴딩 없는 최고품질(용량↑)"로 디더 비용을 명시한다(#146 §4).
 */
export function tierDescription(format: ExportFormat, tier: QualityTier): string {
  if (format === 'mp4') {
    switch (tier) {
      case 'studio':
        return '최고 화질 — 재편집용. 압축이 거의 보이지 않습니다. 품질은 익스포트 속도에 영향을 주지 않습니다.'
      case 'social':
        return '공유에 균형 잡힌 화질과 용량.'
      case 'web':
        return '가벼운 용량 — 웹 임베드용.'
      case 'web-low':
        return '최소 용량 — 화질을 가장 낮춰 파일을 작게.'
    }
  }
  switch (tier) {
    case 'studio':
      return '밴딩 없는 최고품질 — Bayer 디더 적용. 용량이 크게 늘어납니다(Dooray 인라인엔 과할 수 있음).'
    case 'social':
      return '기본 화질(256색, 디더 없음) — 공유에 적합.'
    case 'web':
      return '가벼운 용량(128색).'
    case 'web-low':
      return '최소 용량(64색).'
  }
}

// ─── 메뉴(포맷별 허용값 게이팅) ────────────────────────────────────────────────
// MP4는 60fps·4K까지, GIF는 50fps·1080p가 천장이다(#146 §2).

/** MP4 출력 해상도 옵션(px, 세로). 4K(2160)까지. 원본 초과 옵션은 UI에서 비활성. */
export const MP4_HEIGHTS = [720, 1080, 2160]

/**
 * GIF 출력 해상도 옵션(px, 세로). **4K 미제공** — 용량이 비현실적이라 "최고품질 GIF"와 자기모순(#146 §2).
 * recap 차별화(1080p GIF)를 상한으로 둔다.
 */
export const GIF_HEIGHTS = [720, 1080]

/** 포맷별 허용 해상도 옵션. */
export function heightsForFormat(format: ExportFormat): number[] {
  return format === 'mp4' ? MP4_HEIGHTS : GIF_HEIGHTS
}

/** 해상도 세그먼트 표기 — 2160은 '4K', 그 외는 `{h}p`. */
export function sizeLabel(height: number): string {
  return height >= 2160 ? '4K' : `${height}p`
}

/** GIF fps 옵션 — 친숙한 라벨(표기)과 GIF delay(센티초) 매핑. 실효 fps = 100/delayCs(#119). */
export interface GifFpsOption {
  /** 드롭다운 표기(친숙한 근삿값). */
  label: string
  /** GIF 프레임 delay(센티초). 실효 fps = 100 / delayCs. */
  delayCs: number
}

/**
 * GIF fps 옵션 — 표기 50/30/25/20/15fps, 내부 delayCs 2/3/4/5/7(실효 50/33.3/25/20/14.3).
 * ⚠️ 50fps가 GIF 포맷 천장 — 지연이 센티초 정수라 60fps GIF는 만들 수 없다(60fps는 MP4 전용).
 */
export const GIF_FPS_OPTIONS: GifFpsOption[] = [
  { label: '50fps', delayCs: 2 },
  { label: '30fps', delayCs: 3 },
  { label: '25fps', delayCs: 4 },
  { label: '20fps', delayCs: 5 },
  { label: '15fps', delayCs: 7 }
]

/** MP4 fps 옵션 라벨 — 60/30/24. 60fps는 MP4 전용(포맷별 프레임레이트 게이팅, #146 §2). */
export const MP4_FPS_LABELS = ['60fps', '30fps', '24fps']

/** 포맷별 허용 fps 라벨 — GIF는 50fps 상한, MP4는 60fps까지. */
export function fpsLabelsForFormat(format: ExportFormat): string[] {
  return format === 'mp4' ? MP4_FPS_LABELS : GIF_FPS_OPTIONS.map((o) => o.label)
}

// ─── 티어 → 인코더 파라미터 매핑 ──────────────────────────────────────────────

/**
 * MP4 티어 → H.264 QP(양자화 파라미터). 낮을수록 고화질(#146). WebCodecs QP 모드의 출발점이다.
 * mediabunny가 per-frame QP를 타입 API로 노출하지 않아, export.ts가 이 QP를 subjective Quality로 사상한다.
 */
export const MP4_TIER_QP: Record<QualityTier, number> = {
  studio: 18,
  social: 23,
  web: 28,
  'web-low': 32
}

/** GIF 티어 정책 — 색 수 + Bayer 디더 강도(spread). dither=0이면 디더 없음. */
export interface GifTierPolicy {
  /** 팔레트 최대 색상 수(≤256). */
  maxColors: number
  /** Bayer ordered dither 강도(0=off). Studio 전용(#146 §4, 스윗스팟 s≈16). */
  dither: number
}

/**
 * GIF 티어 → 색 수 + 디더. **Bayer 디더 = Studio 전용**(용량 4배·이득 국소, #146 §4).
 * 나머지 티어는 디더 없이 색 수만 줄여 용량을 낮춘다(#123: GIF 색축 이득은 미묘하나 유일한 레버).
 */
export const GIF_TIER_POLICY: Record<QualityTier, GifTierPolicy> = {
  studio: { maxColors: 256, dither: 16 },
  social: { maxColors: 256, dither: 0 },
  web: { maxColors: 128, dither: 0 },
  'web-low': { maxColors: 64, dither: 0 }
}

// ─── 선택(해상도·fps·티어) ────────────────────────────────────────────────────

/** 익스포트 시점의 사용자 선택 — 4축(포맷은 별도 상태) 중 해상도·fps·티어. */
export interface ExportSelection {
  /** 선택 해상도(px, 세로). 포맷별 옵션 중 하나(원본이 상한). */
  height: number
  /** 선택 fps 옵션 라벨(포맷별 옵션의 label). */
  fps: string
  /** 선택 품질 티어. */
  tier: QualityTier
}

/** 포맷별 기본 선택 — MP4는 1080p/60fps/Studio, GIF는 720p/50fps/Social(디더 없음이 전역 기본, #146 §4). */
export function defaultSelectionForFormat(format: ExportFormat): ExportSelection {
  return format === 'mp4'
    ? { height: 1080, fps: '60fps', tier: 'studio' }
    : { height: 720, fps: '50fps', tier: 'social' }
}

/** 렌더러 초기 선택(GIF 기본) — recap 차별화 축이 GIF라 GIF를 기본 포맷으로 연다. */
export const DEFAULT_SELECTION: ExportSelection = defaultSelectionForFormat('gif')

/**
 * 포맷 토글 시 선택을 새 포맷의 허용 범위로 재조정한다(순수). fps·해상도가 새 포맷에 없으면
 * 포맷 기본값으로 되돌리고, 티어는 포맷과 독립이라 유지한다. 예: MP4(60fps)→GIF 전환 시 fps를 50fps로.
 */
export function reconcileSelectionForFormat(
  format: ExportFormat,
  selection: ExportSelection
): ExportSelection {
  const fallback = defaultSelectionForFormat(format)
  const fps = fpsLabelsForFormat(format).includes(selection.fps) ? selection.fps : fallback.fps
  const height = heightsForFormat(format).includes(selection.height)
    ? selection.height
    : fallback.height
  return { height, fps, tier: selection.tier }
}

/**
 * 원본 세로로부터 기본 선택 해상도를 정한다 — 포맷 기본을 넘지 않으면서 원본을 초과하지 않는 최대 옵션.
 * 원본이 모든 옵션보다 작으면 최소 옵션을 돌려준다(출력은 resolve*Config가 원본으로 캡하므로 업스케일 안 함).
 */
export function defaultHeightForSource(format: ExportFormat, sourceHeight: number): number {
  const options = heightsForFormat(format)
  const preferred = defaultSelectionForFormat(format).height
  const fits = options.filter((h) => h <= sourceHeight && h <= preferred)
  return fits.length > 0 ? Math.max(...fits) : Math.min(...options)
}

// ─── GIF 설정 ─────────────────────────────────────────────────────────────────

/** GIF 인코더에 넘길 확정 설정 — resolveGifConfig의 출력. */
export interface GifConfig {
  /** 출력 가로(px). GIF는 짝수 제약이 없다. */
  width: number
  /** 출력 세로(px). */
  height: number
  /** 프레임 delay(센티초). 실효 fps = 100 / delayCs. */
  delayCs: number
  /** 팔레트 최대 색상 수. */
  maxColors: number
  /** Bayer 디더 강도(0=off). Studio 티어에서만 >0(#146 §4). */
  dither: number
}

/**
 * 원본 크기·선택으로부터 GIF 인코딩 설정을 계산한다(순수).
 * - 해상도: 선택 세로 이하로 비율 유지 축소하되 원본을 넘기지 않는다(업스케일 금지, 원본이 상한).
 * - fps: 선택 옵션의 delayCs를 그대로 넘긴다(라벨을 못 찾으면 기본 옵션).
 * - 색 수·디더: 티어 정책(GIF_TIER_POLICY)에서 가져온다.
 */
export function resolveGifConfig(source: FrameSize, selection: ExportSelection): GifConfig {
  const targetHeight = Math.min(selection.height, source.height)
  const scale = targetHeight / source.height
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const fpsOption = GIF_FPS_OPTIONS.find((o) => o.label === selection.fps) ?? GIF_FPS_OPTIONS[0]
  const policy = GIF_TIER_POLICY[selection.tier]
  return {
    width,
    height,
    delayCs: fpsOption.delayCs,
    maxColors: policy.maxColors,
    dither: policy.dither
  }
}

// ─── MP4 설정 (WebCodecs + mediabunny) ────────────────────────────────────────

/**
 * 기본 H.264 코덱 문자열 — High L5.1(4K 대응). 배포 호환성을 위해 H.264가 기본이다.
 * WebCodecs는 완전 지정 코덱 문자열을 요구한다(`"h264"` 축약 불가). 근거: mp4-export-encoder-decision.md.
 */
export const MP4_CODEC = 'avc1.640033'

/** MP4 인코더에 넘길 확정 설정 — resolveMp4Config의 출력. */
export interface Mp4Config {
  /** 출력 가로(px). H.264는 짝수 치수를 요구하므로 짝수로 맞춘다. */
  width: number
  /** 출력 세로(px). 짝수. */
  height: number
  /** 출력 프레임레이트(fps). */
  fps: number
  /** 완전 지정 코덱 문자열(`avc1.640033`). */
  codec: string
  /** 티어별 H.264 QP(출발점). export.ts가 mediabunny subjective Quality로 사상한다. */
  qp: number
  /** 비트레이트 모드 — QP(품질) 타깃 의도. mediabunny는 Quality 타깃으로 실현한다. */
  bitrateMode: 'quantizer' | 'variable'
  /** 라이브가 아니므로 품질 우선(기본값). */
  latencyMode: 'quality'
  /** macOS VideoToolbox HW 인코딩 힌트(실패 시 자동 폴백). */
  hardwareAcceleration: 'prefer-hardware'
}

/** H.264가 요구하는 짝수 치수로 내림 정렬한다(최소 2). */
function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * fps 옵션 라벨(예 '60fps')에서 정수 fps를 뽑는다. MP4는 라벨 표기값을 그대로 목표 fps로 쓴다.
 * 라벨이 정수로 안 파싱되면 첫 MP4 옵션(60fps)으로 폴백한다.
 */
export function fpsFromLabel(label: string): number {
  const parsed = parseInt(label, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : parseInt(MP4_FPS_LABELS[0], 10)
}

/**
 * 원본 크기·선택으로부터 MP4 인코딩 설정을 계산한다(순수).
 * - 해상도: resolveGifConfig와 동일하게 선택 세로 이하로 비율 유지 축소, 업스케일 금지(원본이 상한).
 *   단 H.264 제약으로 가로·세로를 짝수로 맞춘다.
 * - fps: 선택 옵션 라벨의 표기값을 목표 fps로 그대로 쓴다.
 * - QP: 티어 매핑(MP4_TIER_QP)에서 가져온다.
 */
export function resolveMp4Config(source: FrameSize, selection: ExportSelection): Mp4Config {
  const targetHeight = Math.min(selection.height, source.height)
  const scale = targetHeight / source.height
  return {
    width: toEven(source.width * scale),
    height: toEven(source.height * scale),
    fps: fpsFromLabel(selection.fps),
    codec: MP4_CODEC,
    qp: MP4_TIER_QP[selection.tier],
    bitrateMode: 'quantizer',
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware'
  }
}

// ─── 사전 추정치 (예상 시간·최대 용량) ─────────────────────────────────────────
// SS 패널의 "Estimated export time / Estimated max output size" 모작(#159 AC7).
// 정확한 값이 아니라 보수적(상한) 근사다 — 실제 용량은 콘텐츠 복잡도에 따라 달라진다.

/** 트림된 출력 길이(ms)에서 프레임 수를 센다(각 인코더 루프와 동일한 셈). */
function frameCount(effectiveFps: number, durationMs: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * effectiveFps))
}

/**
 * MP4 티어별 비트당 화소 근사(bits per pixel per frame). QP가 낮을수록(고화질) 커진다.
 * 실측이 아니라 용량 상한을 보수적으로 잡기 위한 계수다.
 */
const MP4_BPP: Record<QualityTier, number> = {
  studio: 0.22,
  social: 0.1,
  web: 0.05,
  'web-low': 0.03
}

/** MP4 예상 최대 용량(bytes) — width·height·fps·길이·티어 bpp 기반 보수적 근사. */
export function estimateMp4Bytes(config: Mp4Config, durationMs: number, tier: QualityTier): number {
  const frames = frameCount(config.fps, durationMs)
  const bitsPerFrame = config.width * config.height * MP4_BPP[tier]
  return Math.round((bitsPerFrame * frames) / 8)
}

/**
 * GIF 예상 최대 용량(bytes) — 화소·프레임 수 기반 보수적 근사.
 * 색 수↓면 LZW가 잘 압축돼 작아지고, 디더는 LZW를 깨 ~4배로 키운다(#146 §4 실측 근거).
 */
export function estimateGifBytes(config: GifConfig, durationMs: number): number {
  const effectiveFps = 100 / config.delayCs
  const frames = frameCount(effectiveFps, durationMs)
  // 256색·무디더 기준 화소당 ~0.45 bytes/frame(LZW 압축 후 보수적), 색 수에 선형 비례.
  const colorFactor = config.maxColors / 256
  const ditherFactor = config.dither > 0 ? 4 : 1
  const bytesPerPixel = 0.45 * colorFactor * ditherFactor
  return Math.round(config.width * config.height * frames * bytesPerPixel)
}

/** 포맷·설정·길이로부터 예상 최대 용량(bytes)을 돌려준다(포맷 분기 래퍼). */
export function estimateSizeBytes(
  format: ExportFormat,
  config: Mp4Config | GifConfig,
  durationMs: number,
  tier: QualityTier
): number {
  return format === 'mp4'
    ? estimateMp4Bytes(config as Mp4Config, durationMs, tier)
    : estimateGifBytes(config as GifConfig, durationMs)
}

/**
 * 예상 익스포트 시간(초) — 프레임 수 × 프레임당 처리 비용 근사.
 * MP4는 VideoToolbox HW 인코딩이라 프레임당 더 싸고, GIF는 팔레트 양자화·LZW가 비싸다.
 * 최소 1초로 바닥을 깐다(SS 표기와 동일하게 정수 초로 보여 준다).
 */
export function estimateExportSeconds(
  format: ExportFormat,
  config: Mp4Config | GifConfig,
  durationMs: number
): number {
  const perFrameMs = format === 'mp4' ? 9 : 22
  const fps = format === 'mp4' ? (config as Mp4Config).fps : 100 / (config as GifConfig).delayCs
  const frames = frameCount(fps, durationMs)
  return Math.max(1, Math.round((frames * perFrameMs) / 1000))
}

// ─── 용량 경고(Dooray 인라인 임계) ─────────────────────────────────────────────

/** GIF 결과 파일 용량 경고 임계(bytes). Dooray 본문 인라인 렌더 부담·뷰어 UX 기준(#118). */
export const DOORAY_WARN_BYTES = 25 * 1024 * 1024

/** 결과가 Dooray 인라인 임계(25MB)를 초과하는지. GIF 경고 판단에 쓴다(#118). */
export function exceedsSizeLimit(sizeBytes: number): boolean {
  return sizeBytes > DOORAY_WARN_BYTES
}
