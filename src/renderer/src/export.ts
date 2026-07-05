/**
 * 익스포트 인코딩 층 — 렌더 레시피를 원본에 적용해 최종 MP4/GIF 바이트를 만드는 후처리 렌더링.
 *
 * 미리보기와 "완전히 동일한" 샘플링·그리기 경로를 공유한다: 매 프레임 sampleComposition으로
 * 카메라·커서·클릭·배경/패딩·배지를 한 번에 얻고 drawComposition으로 그린다 — 보이는 것과
 * 내보내는 것이 같다(SPEC 후처리 렌더링 모델·이슈 #8 수용 기준).
 * MP4는 WebCodecs 인코딩·먹싱을 mediabunny(Chromium 미디어 스택)에 위임하고,
 * GIF는 gifenc(팔레트 양자화 + LZW)로 인코딩한다 — 프레임 생성 경로는 두 포맷이 공유한다.
 *
 * 트림 창 밖 프레임은 익스포트하지 않는다 — 최종 영상 길이는 트림된 길이(trim)를 따른다.
 * 이 층은 효과를 계산하지 않는다(recipe.ts가 굽는다) — 프레임을 뽑아 인코더에 밀 뿐이다.
 */

import { Output, BufferTarget, Mp4OutputFormat, CanvasSource } from 'mediabunny'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { sampleComposition, type RenderRecipe } from '../../shared/recipe'
import { trimmedDurationMs } from '../../shared/recipe.edit'
import { resolveEncodeConfig, resolveGifConfig, type ExportPreset } from '../../shared/export-preset'
import { drawComposition } from './compose'

export interface ExportProgress {
  renderedFrames: number
  totalFrames: number
}

/**
 * 원본 영상 + 렌더 레시피 + 프리셋 → MP4 바이트.
 * 원본을 프레임 단위로 시크하며 미리보기와 같은 경로로 그려 인코딩한다.
 * 진행률은 onProgress로 보고한다. 반환된 ArrayBuffer를 본체가 파일로 저장한다.
 */
export async function renderRecipeToMp4(
  video: HTMLVideoElement,
  recipe: RenderRecipe,
  preset: ExportPreset,
  onProgress?: (p: ExportProgress) => void
): Promise<ArrayBuffer> {
  // 최종 영상 길이는 트림된 길이를 따른다 — 비트레이트 예산·프레임 수 모두 여기서 나온다.
  const outputDurationMs = trimmedDurationMs(recipe)
  const config = resolveEncodeConfig(preset, recipe.source, outputDurationMs)

  const canvas = document.createElement('canvas')
  canvas.width = config.width
  canvas.height = config.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('익스포트 캔버스 컨텍스트를 만들 수 없습니다')
  // drawComposition은 원본(source) 좌표계로 그린다 — 프리셋 해상도로 축소된 캔버스에
  // 맞도록 컨텍스트를 미리 스케일해, 미리보기와 동일한 합성을 그대로 담는다.
  ctx.scale(config.width / recipe.source.width, config.height / recipe.source.height)

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const canvasSource = new CanvasSource(canvas, { codec: config.codec, bitrate: config.bitrate })
  output.addVideoTrack(canvasSource, { frameRate: config.fps })
  await output.start()

  const wasPaused = video.paused
  video.pause()

  const frameDurationSec = 1 / config.fps
  const totalFrames = Math.max(1, Math.round((outputDurationMs / 1000) * config.fps))

  try {
    for (let i = 0; i < totalFrames; i++) {
      const tSec = i * frameDurationSec
      // 출력 타임라인은 0부터지만, 원본에서는 트림 시작 지점부터 샘플링·시크한다.
      const sourceMs = recipe.trim.startMs + tSec * 1000
      await seekVideo(video, sourceMs / 1000)
      const comp = sampleComposition(recipe, sourceMs)
      drawComposition(ctx, video, comp, recipe.source)
      await canvasSource.add(tSec, frameDurationSec)
      onProgress?.({ renderedFrames: i + 1, totalFrames })
    }
    await output.finalize()
  } finally {
    if (!wasPaused) void video.play()
  }

  const buffer = output.target.buffer
  if (!buffer) throw new Error('익스포트 버퍼가 비어 있습니다')
  return buffer
}

/**
 * 원본 영상 + 렌더 레시피 + 프리셋 → GIF 바이트.
 * MP4와 동일하게 sampleComposition·drawComposition로 미리보기와 같은 합성(배경/배지·커서·트림)을
 * 그린 뒤, 프레임마다 팔레트를 양자화해 gifenc로 인코딩한다. 진행률은 onProgress로 보고한다.
 */
export async function renderRecipeToGif(
  video: HTMLVideoElement,
  recipe: RenderRecipe,
  preset: ExportPreset,
  onProgress?: (p: ExportProgress) => void
): Promise<ArrayBuffer> {
  const config = resolveGifConfig(preset, recipe.source)
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
  const frameDelayMs = 1000 / config.fps
  const frameDurationSec = 1 / config.fps
  const totalFrames = Math.max(1, Math.round((outputDurationMs / 1000) * config.fps))

  const wasPaused = video.paused
  video.pause()

  try {
    for (let i = 0; i < totalFrames; i++) {
      const tSec = i * frameDurationSec
      // 출력 타임라인은 0부터지만, 원본에서는 트림 시작 지점부터 샘플링·시크한다.
      const sourceMs = recipe.trim.startMs + tSec * 1000
      await seekVideo(video, sourceMs / 1000)
      const comp = sampleComposition(recipe, sourceMs)
      drawComposition(ctx, video, comp, recipe.source)

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const palette = quantize(data, config.maxColors)
      const index = applyPalette(data, palette)
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
