/**
 * 익스포트 프리셋 — 목적지의 첨부 제한에 맞춰 포맷·해상도·비트레이트를 묶은 익스포트 설정.
 *
 * v1은 GitHub 프리셋 하나뿐이고 UI에 선택·커스텀을 노출하지 않는다 — 데이터로만 정의한다.
 * 순수 TypeScript(Electron·WebCodecs 무의존)라 미리보기·익스포트·테스트가 함께 쓴다.
 *
 * 익스포트 인코딩 층(renderer/export.ts)은 여기서 계산한 EncodeConfig만 소비한다.
 * 효과(줌 등)는 recipe.ts가 이미 굽고, 이 모듈은 "얼마나 크게·얼마의 비트레이트로 담을지"만 정한다.
 */

import type { FrameSize } from './recipe'

/** 익스포트 출력 포맷. 같은 프리셋을 공유하되 목적지 제한만 다르다(영상 100MB / 이미지·GIF 10MB). */
export type ExportFormat = 'mp4' | 'gif'

export interface ExportPreset {
  id: string
  container: 'mp4'
  /** 비디오 코덱 (mediabunny 코덱 식별자). v1은 H.264. */
  codec: 'avc'
  /** 출력 세로 상한(px). 원본이 이보다 크면 비율을 유지하며 축소한다(확대는 안 함). */
  maxHeight: number
  fps: number
  /** 결과 파일 용량 상한(bytes). 초과하면 경고한다. */
  maxSizeBytes: number
  /** 목표 비트레이트 상한(bps). 짧은 영상이 용량 예산을 다 못 써도 과하게 커지지 않게 캡. */
  maxBitrate: number
  /** GIF 출력 세로 상한(px). GIF는 용량이 커 MP4보다 작게 잡는다. */
  gifMaxHeight: number
  /** GIF 프레임레이트. 팔레트·LZW 특성상 MP4보다 낮게 잡아 용량을 억제한다. */
  gifFps: number
  /** GIF 결과 파일 용량 상한(bytes). 초과하면 경고한다(이미지 첨부 제한 타겟). */
  gifMaxSizeBytes: number
  /** GIF 팔레트 최대 색상 수(≤256). */
  gifMaxColors: number
}

/**
 * GitHub 프리셋: 영상 100MB(최대 1080p, H.264 60fps) · GIF 10MB(최대 480p, 15fps) (SPEC 익스포트).
 * v1 유일 프리셋 — 하나의 프리셋이 목적지 제한(영상/이미지)을 모두 담는다.
 */
export const GITHUB_PRESET: ExportPreset = {
  id: 'github',
  container: 'mp4',
  codec: 'avc',
  maxHeight: 1080,
  fps: 60,
  maxSizeBytes: 100 * 1024 * 1024,
  maxBitrate: 12_000_000,
  gifMaxHeight: 480,
  gifFps: 15,
  gifMaxSizeBytes: 10 * 1024 * 1024,
  gifMaxColors: 256
}

/** 인코더에 넘길 확정 설정 — resolveEncodeConfig의 출력. */
export interface EncodeConfig {
  /** 출력 가로(px, 짝수). */
  width: number
  /** 출력 세로(px, 짝수). */
  height: number
  fps: number
  codec: 'avc'
  /** 목표 비트레이트(bps). */
  bitrate: number
}

/** 용량 예산에서 컨테이너 오버헤드·VBR 변동을 감안한 안전 마진. */
const SIZE_SAFETY = 0.95

/** H.264는 가로·세로가 짝수여야 한다. 가장 가까운 짝수로 맞추되 최소 2. */
function roundEven(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

/**
 * 프리셋·원본 크기·길이로부터 인코딩 설정을 계산한다(순수).
 * - 해상도: 원본을 maxHeight 이하로 비율 유지 축소(원본보다 키우지 않음), 짝수 보정.
 * - 비트레이트: 용량 상한(bytes)을 길이로 나눠 산정하되 maxBitrate로 캡. 길이 0이면 상한 사용.
 */
export function resolveEncodeConfig(
  preset: ExportPreset,
  source: FrameSize,
  durationMs: number
): EncodeConfig {
  const scale = Math.min(1, preset.maxHeight / source.height)
  const width = roundEven(source.width * scale)
  const height = roundEven(source.height * scale)

  const durationSec = durationMs / 1000
  const budgetBits = preset.maxSizeBytes * 8 * SIZE_SAFETY
  const bitrate =
    durationSec > 0
      ? Math.min(preset.maxBitrate, Math.floor(budgetBits / durationSec))
      : preset.maxBitrate

  return { width, height, fps: preset.fps, codec: preset.codec, bitrate }
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

/** 포맷별 용량 상한(bytes). 영상은 maxSizeBytes, GIF는 gifMaxSizeBytes. */
export function sizeLimitBytes(preset: ExportPreset, format: ExportFormat): number {
  return format === 'gif' ? preset.gifMaxSizeBytes : preset.maxSizeBytes
}

/** 결과 파일이 포맷별 용량 상한을 초과하는지. UI 경고 판단에 쓴다(AC4). */
export function exceedsSizeLimit(
  preset: ExportPreset,
  sizeBytes: number,
  format: ExportFormat = 'mp4'
): boolean {
  return sizeBytes > sizeLimitBytes(preset, format)
}
