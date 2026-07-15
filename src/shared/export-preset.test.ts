import { describe, it, expect } from 'vitest'
import {
  DOORAY_GIF_PRESET,
  resolveGifConfig,
  exceedsSizeLimit,
  sizeLimitBytes,
  type ExportPreset
} from './export-preset'

describe('Dooray GIF 프리셋: 데이터로 정의된 v1 유일 프리셋', () => {
  it('GIF 단일 출력 — 최대 480p·15fps·≤256색·10MB 경고 임계', () => {
    expect(DOORAY_GIF_PRESET.gifMaxHeight).toBe(480)
    expect(DOORAY_GIF_PRESET.gifFps).toBe(15)
    expect(DOORAY_GIF_PRESET.gifMaxSizeBytes).toBe(10 * 1024 * 1024)
    expect(DOORAY_GIF_PRESET.gifMaxColors).toBeLessThanOrEqual(256)
  })
})

describe('resolveGifConfig: (프리셋, 원본 크기) → GIF 인코딩 설정', () => {
  it('원본을 gifMaxHeight 이하로 비율 유지 축소한다', () => {
    // 원본 2880×1800 → gifMaxHeight 480이면 scale 0.2667 → 768×480.
    const cfg = resolveGifConfig(DOORAY_GIF_PRESET, { width: 2880, height: 1800 })
    expect(cfg.height).toBe(480)
    expect(cfg.width).toBe(768)
    expect(cfg.fps).toBe(DOORAY_GIF_PRESET.gifFps)
    expect(cfg.maxColors).toBe(DOORAY_GIF_PRESET.gifMaxColors)
  })

  it('원본이 상한보다 작으면 확대하지 않는다', () => {
    const cfg = resolveGifConfig(DOORAY_GIF_PRESET, { width: 320, height: 240 })
    expect(cfg.width).toBe(320)
    expect(cfg.height).toBe(240)
  })
})

describe('용량 경고 임계 판정 (AC4)', () => {
  const preset: ExportPreset = { ...DOORAY_GIF_PRESET, gifMaxSizeBytes: 500 }

  it('sizeLimitBytes는 GIF 용량 임계를 돌려준다', () => {
    expect(sizeLimitBytes(preset)).toBe(500)
  })

  it('임계를 넘는 크기만 초과로 판정한다', () => {
    expect(exceedsSizeLimit(preset, 500)).toBe(false)
    expect(exceedsSizeLimit(preset, 501)).toBe(true)
  })
})
