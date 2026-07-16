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
