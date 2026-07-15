/**
 * 익스포트 프리셋 — 목적지(Dooray 업무 첨부)에 맞춰 GIF 해상도·프레임레이트·색 수를 묶은 설정.
 *
 * v1은 Dooray GIF 프리셋 하나뿐이고 UI에 선택·커스텀을 노출하지 않는다 — 데이터로만 정의한다.
 * 순수 TypeScript(Electron·WebCodecs 무의존)라 미리보기·익스포트·테스트가 함께 쓴다.
 *
 * 익스포트 인코딩 층(renderer/export.ts)은 여기서 계산한 GifConfig만 소비한다.
 * 효과(줌 등)는 recipe.ts가 이미 굽고, 이 모듈은 "얼마나 크게·몇 fps·몇 색으로 담을지"만 정한다.
 */

import type { FrameSize } from './recipe'

export interface ExportPreset {
  id: string
  /** GIF 출력 세로 상한(px). 원본이 이보다 크면 비율을 유지하며 축소한다(확대는 안 함). */
  gifMaxHeight: number
  /** GIF 프레임레이트. */
  gifFps: number
  /** GIF 결과 파일 용량 경고 임계(bytes). Dooray 본문 인라인 렌더 부담·뷰어 UX 기준(#118). */
  gifMaxSizeBytes: number
  /** GIF 팔레트 최대 색상 수(≤256). */
  gifMaxColors: number
}

/**
 * Dooray GIF 프리셋: 업무 첨부용 GIF(최대 480p, 15fps, ≤256색, 10MB 경고 임계).
 * v1 유일 프리셋 — export 출력은 GIF 단일이다.
 */
export const DOORAY_GIF_PRESET: ExportPreset = {
  id: 'dooray-gif',
  gifMaxHeight: 480,
  gifFps: 15,
  gifMaxSizeBytes: 10 * 1024 * 1024,
  gifMaxColors: 256
}

/** GIF 인코더에 넘길 확정 설정 — resolveGifConfig의 출력. */
export interface GifConfig {
  /** 출력 가로(px). GIF는 짝수 제약이 없다. */
  width: number
  /** 출력 세로(px). */
  height: number
  fps: number
  /** 팔레트 최대 색상 수. */
  maxColors: number
}

/**
 * 프리셋·원본 크기로부터 GIF 인코딩 설정을 계산한다(순수).
 * - 해상도: 원본을 gifMaxHeight 이하로 비율 유지 축소(원본보다 키우지 않음).
 * - 비트레이트 개념이 없어 길이는 쓰지 않는다(용량은 해상도·fps·프레임 수로 결정된다).
 */
export function resolveGifConfig(preset: ExportPreset, source: FrameSize): GifConfig {
  const scale = Math.min(1, preset.gifMaxHeight / source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  return { width, height, fps: preset.gifFps, maxColors: preset.gifMaxColors }
}

/** GIF 용량 경고 임계(bytes). */
export function sizeLimitBytes(preset: ExportPreset): number {
  return preset.gifMaxSizeBytes
}

/** 결과 GIF가 용량 경고 임계를 초과하는지. UI 경고 판단에 쓴다(AC4). */
export function exceedsSizeLimit(preset: ExportPreset, sizeBytes: number): boolean {
  return sizeBytes > sizeLimitBytes(preset)
}
