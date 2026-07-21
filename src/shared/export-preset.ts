/**
 * 익스포트 프리셋 — 목적지(Dooray 업무 첨부)에 맞춰 GIF 색 수·용량 정책을 묶은 설정.
 *
 * v1은 export = GIF 단일이고, 해상도·fps는 익스포트 시점에 사용자가 드롭다운으로 고른다(#122).
 * 세 개념을 분리한다: 메뉴(허용값·기본값)는 모듈 상수, 정책(색 수·용량 경고)은 프리셋,
 * 선택(해상도·fps)은 명시 인자. 순수 TypeScript(Electron·WebCodecs 무의존)라
 * 미리보기·익스포트·테스트가 함께 쓴다.
 *
 * 익스포트 인코딩 층(renderer/export.ts)은 여기서 계산한 GifConfig만 소비한다.
 * 효과(줌 등)는 recipe.ts가 이미 굽고, 이 모듈은 "얼마나 크게·몇 fps·몇 색으로 담을지"만 정한다.
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

/** 익스포트 프리셋 — 목적지별 정책(색 수·용량 경고)만 담는다. 해상도·fps는 선택 인자로 넘긴다. */
export interface ExportPreset {
  id: string
  /** GIF 결과 파일 용량 경고 임계(bytes). Dooray 본문 인라인 렌더 부담·뷰어 UX 기준(#118). */
  warnSizeBytes: number
  /** GIF 팔레트 최대 색상 수(≤256). */
  maxColors: number
}

/**
 * Dooray GIF 프리셋: 정책만 담는다(≤256색, 25MB 경고 임계).
 * v1 유일 프리셋 — export 출력은 GIF 단일이고 해상도·fps는 선택으로 넘긴다.
 */
export const DOORAY_GIF_PRESET: ExportPreset = {
  id: 'dooray-gif',
  warnSizeBytes: 25 * 1024 * 1024,
  maxColors: 256
}

/** 해상도 드롭다운 허용값(px, 세로). 원본이 상한 — 초과 옵션은 비활성한다. */
export const GIF_HEIGHTS = [480, 720, 1080]

/** fps 드롭다운 옵션 — 친숙한 라벨(표기)과 GIF delay(센티초) 매핑. 실효 fps는 100/delayCs(#119). */
export interface GifFpsOption {
  /** 드롭다운 표기(친숙한 근삿값). */
  label: string
  /** GIF 프레임 delay(센티초). 실효 fps = 100 / delayCs. */
  delayCs: number
}

/** fps 옵션 — 표기 50/30/25/20/15fps, 내부 delayCs 2/3/4/5/7(실효 50/33.3/25/20/14.3). */
export const GIF_FPS_OPTIONS: GifFpsOption[] = [
  { label: '50fps', delayCs: 2 },
  { label: '30fps', delayCs: 3 },
  { label: '25fps', delayCs: 4 },
  { label: '20fps', delayCs: 5 },
  { label: '15fps', delayCs: 7 }
]

/** 익스포트 시점의 사용자 선택(해상도·fps). fps는 옵션 라벨로 지목한다. */
export interface GifSelection {
  /** 선택 해상도(px, 세로). GIF_HEIGHTS 중 하나. */
  height: number
  /** 선택 fps 옵션 라벨(GIF_FPS_OPTIONS의 label). */
  fps: string
}

/** 드롭다운 기본 선택 — 720p/50fps. 원본이 720p 미만이면 defaultHeightForSource로 폴백한다. */
export const DEFAULT_SELECTION: GifSelection = { height: 720, fps: '50fps' }

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
}

/**
 * 프리셋·원본 크기·선택으로부터 GIF 인코딩 설정을 계산한다(순수).
 * - 해상도: 선택 세로 이하로 비율 유지 축소하되 원본을 넘기지 않는다(업스케일 금지, 원본이 상한).
 * - fps: 선택 옵션의 delayCs를 그대로 넘긴다(라벨을 못 찾으면 기본 옵션).
 * - 비트레이트 개념이 없어 길이는 쓰지 않는다(용량은 해상도·fps·프레임 수로 결정된다).
 */
export function resolveGifConfig(
  preset: ExportPreset,
  source: FrameSize,
  selection: GifSelection
): GifConfig {
  const targetHeight = Math.min(selection.height, source.height)
  const scale = targetHeight / source.height
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const fpsOption = GIF_FPS_OPTIONS.find((o) => o.label === selection.fps) ?? GIF_FPS_OPTIONS[0]
  return { width, height, delayCs: fpsOption.delayCs, maxColors: preset.maxColors }
}

/**
 * 원본 세로로부터 기본 선택 해상도를 정한다 — 기본 720p지만 원본을 초과하지 않는다.
 * 원본이 720p 미만이면 가능한 최대 옵션으로 폴백하고, 최소 옵션(480p)보다도 작으면 최소 옵션을 돌려준다
 * (출력은 resolveGifConfig가 원본으로 캡하므로 업스케일되지 않는다).
 */
export function defaultHeightForSource(sourceHeight: number): number {
  const fits = GIF_HEIGHTS.filter((h) => h <= sourceHeight && h <= DEFAULT_SELECTION.height)
  return fits.length > 0 ? Math.max(...fits) : Math.min(...GIF_HEIGHTS)
}

/** GIF 용량 경고 임계(bytes). */
export function sizeLimitBytes(preset: ExportPreset): number {
  return preset.warnSizeBytes
}

/** 결과 GIF가 용량 경고 임계를 초과하는지. UI 경고 판단에 쓴다(AC4). */
export function exceedsSizeLimit(preset: ExportPreset, sizeBytes: number): boolean {
  return sizeBytes > sizeLimitBytes(preset)
}

// ─── MP4 (WebCodecs + mediabunny) ─────────────────────────────────────────────
// GIF 경로와 대칭 — 합성은 완전 재사용하고 인코더만 분기한다(#155·결정 #141).
// 해상도·fps 선택 모델(GifSelection)은 GIF와 공유한다(포맷 우선 UI 재구조화는 후속 #146).

/**
 * 기본 H.264 코덱 문자열 — High L5.1(4K 대응). 배포 호환성을 위해 H.264가 기본이다.
 * WebCodecs는 완전 지정 코덱 문자열을 요구한다(`"h264"` 축약 불가). 근거: mp4-export-encoder-decision.md.
 */
export const MP4_CODEC = 'avc1.640033'

/** MP4 인코더에 넘길 확정 설정 — resolveMp4Config의 출력. 결정 문서의 권고 인코더 파라미터를 담는다. */
export interface Mp4Config {
  /** 출력 가로(px). H.264는 짝수 치수를 요구하므로 짝수로 맞춘다. */
  width: number
  /** 출력 세로(px). 짝수. */
  height: number
  /** 출력 프레임레이트(fps). */
  fps: number
  /** 완전 지정 코덱 문자열(`avc1.640033`). */
  codec: string
  /**
   * 비트레이트 모드 — "최대 화질"엔 비트레이트 타깃보다 품질(QP) 타깃이 유리(결정 문서).
   * mediabunny는 이 의도를 Quality 타깃으로 실현한다(renderRecipeToMp4 참조).
   */
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
 * fps 옵션 라벨(예 '50fps')에서 정수 fps를 뽑는다. GIF와 달리 MP4는 라벨의 표기값을
 * 그대로 목표 fps로 쓴다(GIF는 delayCs 근삿값이지만 MP4는 정수 fps 지정). 라벨을 못 찾으면 기본 옵션.
 */
export function fpsFromLabel(label: string): number {
  const option = GIF_FPS_OPTIONS.find((o) => o.label === label) ?? GIF_FPS_OPTIONS[0]
  return parseInt(option.label, 10)
}

/**
 * 원본 크기·선택으로부터 MP4 인코딩 설정을 계산한다(순수).
 * - 해상도: resolveGifConfig와 동일하게 선택 세로 이하로 비율 유지 축소, 업스케일 금지(원본이 상한).
 *   단 H.264 제약으로 가로·세로를 짝수로 맞춘다.
 * - fps: 선택 옵션 라벨의 표기값을 목표 fps로 그대로 쓴다.
 * - 인코더 파라미터는 결정 문서(mp4-export-encoder-decision.md)의 권고 출발점을 고정한다.
 */
export function resolveMp4Config(source: FrameSize, selection: GifSelection): Mp4Config {
  const targetHeight = Math.min(selection.height, source.height)
  const scale = targetHeight / source.height
  return {
    width: toEven(source.width * scale),
    height: toEven(source.height * scale),
    fps: fpsFromLabel(selection.fps),
    codec: MP4_CODEC,
    bitrateMode: 'quantizer',
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware'
  }
}
