/**
 * 익스포트 인코딩 층 — 렌더 레시피를 원본에 적용해 최종 바이트(GIF/MP4)를 만드는 후처리 렌더링.
 *
 * 미리보기와 "완전히 동일한" 샘플링·그리기 경로를 공유한다: 매 프레임 sampleComposition으로
 * 카메라·커서·클릭·배경/패딩·배지를 한 번에 얻고 drawComposition으로 그린다 — 보이는 것과
 * 내보내는 것이 같다(SPEC 후처리 렌더링 모델·이슈 #8 수용 기준).
 * GIF는 gifenc(팔레트 양자화 + LZW), MP4는 WebCodecs `VideoEncoder`+mediabunny로 인코딩한다.
 * 두 경로는 합성을 완전히 재사용하고 인코더만 분기한다(GIF 경로와 대칭, #155·결정 #141).
 *
 * 트림 창 밖 프레임은 익스포트하지 않는다 — 최종 영상 길이는 트림된 길이(trim)를 따른다.
 * 이 층은 효과를 계산하지 않는다(recipe.ts가 굽는다) — 프레임을 뽑아 인코더에 밀 뿐이다.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Quality,
  QUALITY_VERY_HIGH,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_LOW
} from 'mediabunny'
import { sampleComposition, type RenderRecipe } from '../../shared/recipe'
import { trimmedDurationMs } from '../../shared/recipe.edit'
import {
  resolveGifConfig,
  resolveMp4Config,
  type GifConfig,
  type ExportSelection
} from '../../shared/export-preset'
import { drawComposition } from './compose'

export interface ExportProgress {
  renderedFrames: number
  totalFrames: number
}

/**
 * 익스포트 취소 토큰 — 전체화면 진행 화면의 "Stop export"가 aborted를 세우면 인코딩 루프가
 * 다음 프레임 경계에서 AbortError를 던진다. AbortController를 안 쓰는 이유는 렌더러 로컬
 * 협조적 취소면 충분하고(네트워크·워커 없음) 타입이 단순해서다.
 */
export interface ExportSignal {
  aborted: boolean
}

/** 취소 토큰이 세워졌으면 AbortError를 던진다(호출부가 name으로 취소를 구분해 idle 복귀). */
function throwIfAborted(signal?: ExportSignal): void {
  if (signal?.aborted) {
    const err = new Error('익스포트가 취소되었습니다')
    err.name = 'AbortError'
    throw err
  }
}

// ─── 8×8 Bayer ordered dither ─────────────────────────────────────────────────
// GIF Studio 티어 전용 밴딩 억제(#146 §4). quantize 앞단에서 RGBA 복사본에 적용한다 —
// gifenc는 디더를 내장하지 않으므로(프로토타입 harness와 동일 방식) 여기서 재현한다.
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
]
// 정규화 임계값 -0.5..+0.484 (값/64 - 0.5).
const BAYER_THRESH = BAYER8.map((row) => row.map((v) => v / 64 - 0.5))

/**
 * 프레임 RGBA에 Bayer ordered dither를 적용한 복사본을 돌려준다(알파 불변). spread=확산 강도.
 * spread가 0이면 원본 복사만 하고, 아니면 화소마다 고정 패턴 오프셋을 더해 밴딩을 잘게 흩는다.
 */
function ditherRgba(src: Uint8ClampedArray, width: number, height: number, spread: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src)
  if (spread <= 0) return out
  for (let y = 0; y < height; y++) {
    const brow = BAYER_THRESH[y & 7]
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const t = brow[x & 7] * spread
      out[o] = src[o] + t
      out[o + 1] = src[o + 1] + t
      out[o + 2] = src[o + 2] + t
      // 알파 유지
    }
  }
  return out
}

/**
 * MP4 티어 QP → mediabunny subjective Quality 사상. mediabunny는 per-frame QP를 타입 API로
 * 노출하지 않아 QP 의도를 5단계 Quality로 근사한다(결정 문서의 "품질 타깃" 의도와 정합).
 */
function qualityForQp(qp: number): Quality {
  if (qp <= 18) return QUALITY_VERY_HIGH
  if (qp <= 23) return QUALITY_HIGH
  if (qp <= 28) return QUALITY_MEDIUM
  return QUALITY_LOW
}

/**
 * 원본 영상 + 렌더 레시피 + 선택(해상도·fps·티어) → GIF 바이트.
 * sampleComposition·drawComposition로 미리보기와 같은 합성(배경/배지·커서·트림)을 그린 뒤,
 * 프레임마다 팔레트를 양자화해 gifenc로 인코딩한다. Studio 티어면 quantize 앞단에 Bayer 디더를
 * 적용한다(#146 §4). 루프는 무한 반복 고정(gifenc GIFEncoder 기본 repeat=0). 진행률은 onProgress로 보고한다.
 */
export async function renderRecipeToGif(
  video: HTMLVideoElement,
  recipe: RenderRecipe,
  selection: ExportSelection,
  onProgress?: (p: ExportProgress) => void,
  signal?: ExportSignal
): Promise<ArrayBuffer> {
  const config: GifConfig = resolveGifConfig(recipe.source, selection)
  // 최종 GIF 길이도 트림된 길이를 따른다.
  const outputDurationMs = trimmedDurationMs(recipe)

  const canvas = document.createElement('canvas')
  canvas.width = config.width
  canvas.height = config.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('GIF 캔버스 컨텍스트를 만들 수 없습니다')
  // MP4와 동일하게 원본 좌표계로 그리도록 컨텍스트를 축소 스케일한다(미리보기와 동일 합성).
  ctx.scale(config.width / recipe.source.width, config.height / recipe.source.height)

  const encoder = GIFEncoder()
  // delayCs(센티초)가 프레임 간격을 정한다 — 실효 fps = 100 / delayCs(#119). gifenc의 delay는 ms.
  const frameDelayMs = config.delayCs * 10
  const effectiveFps = 100 / config.delayCs
  const frameDurationSec = 1 / effectiveFps
  const totalFrames = Math.max(1, Math.round((outputDurationMs / 1000) * effectiveFps))

  const wasPaused = video.paused
  video.pause()

  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal)
      const tSec = i * frameDurationSec
      // 출력 타임라인은 0부터지만, 원본에서는 트림 시작 지점부터 샘플링·시크한다.
      const sourceMs = recipe.trim.startMs + tSec * 1000
      await seekVideo(video, sourceMs / 1000)
      const comp = sampleComposition(recipe, sourceMs)
      drawComposition(ctx, video, comp, recipe.source)

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      // Studio 티어(dither>0)면 밴딩 억제용 Bayer 디더를 quantize 앞단에 적용한다(#146 §4).
      const pixels = ditherRgba(data, canvas.width, canvas.height, config.dither)
      const palette = quantize(pixels, config.maxColors)
      const index = applyPalette(pixels, palette)
      encoder.writeFrame(index, canvas.width, canvas.height, { palette, delay: frameDelayMs })
      onProgress?.({ renderedFrames: i + 1, totalFrames })
    }
    encoder.finish()
  } finally {
    if (!wasPaused) void video.play()
  }

  // bytes()는 정확히 잘린 사본이라 buffer 전체가 GIF 데이터다(부분 뷰 아님).
  return encoder.bytes().buffer as ArrayBuffer
}

/**
 * 원본 영상 + 렌더 레시피 + 선택(해상도·fps) → H.264 MP4 바이트.
 * renderRecipeToGif와 대칭 — sampleComposition·drawComposition로 미리보기와 같은 합성을 그린 뒤,
 * 프레임마다 합성 캔버스를 mediabunny CanvasSource로 밀어 WebCodecs(VideoToolbox) H.264로 인코딩하고
 * Mp4OutputFormat+BufferTarget에서 ArrayBuffer를 회수한다. 진행률은 onProgress로 보고한다.
 *
 * mediabunny는 WebCodecs `bitrateMode: quantizer`/per-frame QP를 타입 API로 노출하지 않고
 * QP 의도를 Quality 타깃(QUALITY_VERY_HIGH)으로 실현한다 — 결정 문서의 "품질(QP) 타깃" 의도와 정합.
 * mp4 muxing에 필요한 AVCC(avc.format=avc)는 mediabunny가 내부에서 처리한다.
 */
export async function renderRecipeToMp4(
  video: HTMLVideoElement,
  recipe: RenderRecipe,
  selection: ExportSelection,
  onProgress?: (p: ExportProgress) => void,
  signal?: ExportSignal
): Promise<ArrayBuffer> {
  const config = resolveMp4Config(recipe.source, selection)
  // 티어 QP를 mediabunny subjective Quality로 사상한다(품질 티어 → 인코더 파라미터, #146).
  const quality = qualityForQp(config.qp)

  // 모든 설정은 인코딩 전 isConfigSupported로 사전 게이팅한다(칩·OS별 상한 상이). 미지원 시 명확히 실패.
  const supported = await canEncodeVideo('avc', {
    width: config.width,
    height: config.height,
    bitrate: quality,
    fullCodecString: config.codec,
    latencyMode: config.latencyMode,
    hardwareAcceleration: config.hardwareAcceleration
  })
  if (!supported) {
    throw new Error(`이 기기에서 지원하지 않는 MP4 인코더 설정입니다 (H.264 ${config.codec})`)
  }

  // 최종 MP4 길이도 트림된 길이를 따른다.
  const outputDurationMs = trimmedDurationMs(recipe)

  const canvas = document.createElement('canvas')
  canvas.width = config.width
  canvas.height = config.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('MP4 캔버스 컨텍스트를 만들 수 없습니다')
  // GIF와 동일하게 원본 좌표계로 그리도록 컨텍스트를 축소 스케일한다(미리보기와 동일 합성).
  ctx.scale(config.width / recipe.source.width, config.height / recipe.source.height)

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: quality,
    fullCodecString: config.codec,
    latencyMode: config.latencyMode,
    hardwareAcceleration: config.hardwareAcceleration
  })
  output.addVideoTrack(source, { frameRate: config.fps })
  await output.start()

  const frameDurationSec = 1 / config.fps
  const totalFrames = Math.max(1, Math.round((outputDurationMs / 1000) * config.fps))

  const wasPaused = video.paused
  video.pause()

  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal)
      const tSec = i * frameDurationSec
      // 출력 타임라인은 0부터지만, 원본에서는 트림 시작 지점부터 샘플링·시크한다.
      const sourceMs = recipe.trim.startMs + tSec * 1000
      await seekVideo(video, sourceMs / 1000)
      const comp = sampleComposition(recipe, sourceMs)
      drawComposition(ctx, video, comp, recipe.source)

      // 캔버스 현재 상태를 프레임으로 캡처·인코딩한다. add의 Promise를 await해 백프레셔를 지킨다.
      await source.add(tSec, frameDurationSec)
      onProgress?.({ renderedFrames: i + 1, totalFrames })
    }
    await output.finalize()
  } finally {
    if (!wasPaused) void video.play()
  }

  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('MP4 인코딩 결과가 비어 있습니다')
  return buffer
}

/** 영상을 지정 시각(초)으로 시크하고 프레임이 준비될 때까지 기다린다. */
function seekVideo(video: HTMLVideoElement, tSec: number): Promise<void> {
  const target = video.duration ? Math.min(tSec, video.duration) : tSec
  // 이미 그 프레임이면 seeked가 안 오므로 즉시 진행(첫 프레임 t=0 방지).
  if (Math.abs(video.currentTime - target) < 1e-3) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const onSeeked = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error('원본 영상 시크에 실패했습니다'))
    }
    const cleanup = (): void => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = target
  })
}
