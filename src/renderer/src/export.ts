/**
 * 익스포트 인코딩 층 — 렌더 레시피를 원본에 적용해 최종 GIF 바이트를 만드는 후처리 렌더링.
 *
 * 미리보기와 "완전히 동일한" 샘플링·그리기 경로를 공유한다: 매 프레임 sampleComposition으로
 * 카메라·커서·클릭·배경/패딩·배지를 한 번에 얻고 drawComposition으로 그린다 — 보이는 것과
 * 내보내는 것이 같다(SPEC 후처리 렌더링 모델·이슈 #8 수용 기준).
 * GIF는 gifenc(팔레트 양자화 + LZW)로 인코딩한다.
 *
 * 트림 창 밖 프레임은 익스포트하지 않는다 — 최종 영상 길이는 트림된 길이(trim)를 따른다.
 * 이 층은 효과를 계산하지 않는다(recipe.ts가 굽는다) — 프레임을 뽑아 인코더에 밀 뿐이다.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { sampleComposition, type RenderRecipe } from '../../shared/recipe'
import { trimmedDurationMs } from '../../shared/recipe.edit'
import { resolveGifConfig, type ExportPreset, type GifSelection } from '../../shared/export-preset'
import { drawComposition } from './compose'

export interface ExportProgress {
  renderedFrames: number
  totalFrames: number
}

/**
 * 원본 영상 + 렌더 레시피 + 프리셋 + 선택(해상도·fps) → GIF 바이트.
 * sampleComposition·drawComposition로 미리보기와 같은 합성(배경/배지·커서·트림)을
 * 그린 뒤, 프레임마다 팔레트를 양자화해 gifenc로 인코딩한다. 진행률은 onProgress로 보고한다.
 */
export async function renderRecipeToGif(
  video: HTMLVideoElement,
  recipe: RenderRecipe,
  preset: ExportPreset,
  selection: GifSelection,
  onProgress?: (p: ExportProgress) => void
): Promise<ArrayBuffer> {
  const config = resolveGifConfig(preset, recipe.source, selection)
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
