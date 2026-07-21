import { describe, it, expect } from 'vitest'
import {
  DOORAY_GIF_PRESET,
  GIF_HEIGHTS,
  GIF_FPS_OPTIONS,
  DEFAULT_SELECTION,
  resolveGifConfig,
  defaultHeightForSource,
  exceedsSizeLimit,
  sizeLimitBytes,
  extensionForFormat,
  fpsFromLabel,
  resolveMp4Config,
  MP4_CODEC,
  type ExportPreset,
  type ExportFormat,
  type GifSelection
} from './export-preset'

describe('Dooray GIF 프리셋: 정책만 담은 v1 유일 프리셋', () => {
  it('해상도·fps는 선택으로 넘기고, 프리셋엔 색 수·용량 경고 정책만 남는다', () => {
    expect(DOORAY_GIF_PRESET.maxColors).toBe(256)
    expect(DOORAY_GIF_PRESET.warnSizeBytes).toBe(25 * 1024 * 1024)
  })
})

describe('메뉴 상수: 드롭다운 허용값·기본값', () => {
  it('해상도는 480/720/1080p 고정', () => {
    expect(GIF_HEIGHTS).toEqual([480, 720, 1080])
  })

  it('fps는 50/30/25/20/15 라벨 + delayCs 2/3/4/5/7 매핑', () => {
    expect(GIF_FPS_OPTIONS.map((o) => o.label)).toEqual([
      '50fps',
      '30fps',
      '25fps',
      '20fps',
      '15fps'
    ])
    expect(GIF_FPS_OPTIONS.map((o) => o.delayCs)).toEqual([2, 3, 4, 5, 7])
  })

  it('기본 선택은 720p/50fps', () => {
    expect(DEFAULT_SELECTION).toEqual({ height: 720, fps: '50fps' })
  })
})

describe('resolveGifConfig: (프리셋, 원본, 선택) → GIF 인코딩 설정', () => {
  const sel = (height: number, fps: string): GifSelection => ({ height, fps })

  it('선택 해상도로 비율 유지 축소한다', () => {
    // 원본 2880×1800 → 720p 선택이면 scale 0.4 → 1152×720.
    const cfg = resolveGifConfig(DOORAY_GIF_PRESET, { width: 2880, height: 1800 }, sel(720, '50fps'))
    expect(cfg.height).toBe(720)
    expect(cfg.width).toBe(1152)
    expect(cfg.maxColors).toBe(256)
  })

  it('원본을 초과하는 선택은 원본으로 캡한다(업스케일 금지)', () => {
    // 원본 720p인데 1080p를 골라도 원본(720p)을 넘기지 않는다.
    const cfg = resolveGifConfig(DOORAY_GIF_PRESET, { width: 1280, height: 720 }, sel(1080, '50fps'))
    expect(cfg.height).toBe(720)
    expect(cfg.width).toBe(1280)
  })

  it('선택 fps를 delayCs로 인코더에 전달한다', () => {
    const c50 = resolveGifConfig(DOORAY_GIF_PRESET, { width: 100, height: 100 }, sel(480, '50fps'))
    const c15 = resolveGifConfig(DOORAY_GIF_PRESET, { width: 100, height: 100 }, sel(480, '15fps'))
    expect(c50.delayCs).toBe(2)
    expect(c15.delayCs).toBe(7)
  })
})

describe('defaultHeightForSource: 원본 상한 안에서의 기본 해상도', () => {
  it('원본이 720p 이상이면 기본 720p', () => {
    expect(defaultHeightForSource(1080)).toBe(720)
    expect(defaultHeightForSource(720)).toBe(720)
  })

  it('원본이 720p 미만이면 가능한 최대 옵션으로 폴백', () => {
    expect(defaultHeightForSource(600)).toBe(480)
  })

  it('원본이 최소 옵션(480p)보다 작아도 최소 옵션을 돌려준다(출력은 원본으로 캡)', () => {
    expect(defaultHeightForSource(320)).toBe(480)
  })
})

describe('ExportFormat: 포맷 차원 재도입 (#155)', () => {
  it('확장자는 포맷 문자열과 같다(export.{ext})', () => {
    const gif: ExportFormat = 'gif'
    const mp4: ExportFormat = 'mp4'
    expect(extensionForFormat(gif)).toBe('gif')
    expect(extensionForFormat(mp4)).toBe('mp4')
  })
})

describe('fpsFromLabel: MP4는 라벨 표기값을 목표 fps로 쓴다', () => {
  it('옵션 라벨의 정수 표기를 그대로 fps로 돌려준다', () => {
    expect(fpsFromLabel('50fps')).toBe(50)
    expect(fpsFromLabel('15fps')).toBe(15)
  })

  it('알 수 없는 라벨은 첫 옵션(50fps)으로 폴백한다', () => {
    expect(fpsFromLabel('999fps')).toBe(50)
  })
})

describe('resolveMp4Config: (원본, 선택) → MP4 인코딩 설정', () => {
  const sel = (height: number, fps: string): GifSelection => ({ height, fps })

  it('선택 해상도로 비율 유지 축소하되 짝수 치수로 맞춘다(H.264 제약)', () => {
    // 원본 2880×1800 → 720p 선택이면 scale 0.4 → 1152×720(둘 다 짝수).
    const cfg = resolveMp4Config({ width: 2880, height: 1800 }, sel(720, '50fps'))
    expect(cfg.width).toBe(1152)
    expect(cfg.height).toBe(720)
  })

  it('홀수로 떨어지는 치수를 짝수로 정렬한다', () => {
    // 원본 1365×767 → 480p면 세로 480, 가로 1365*480/767≈854.4 → 854(짝수).
    const cfg = resolveMp4Config({ width: 1365, height: 767 }, sel(480, '50fps'))
    expect(cfg.height % 2).toBe(0)
    expect(cfg.width % 2).toBe(0)
  })

  it('원본을 초과하는 선택은 원본으로 캡한다(업스케일 금지)', () => {
    const cfg = resolveMp4Config({ width: 1280, height: 720 }, sel(1080, '50fps'))
    expect(cfg.height).toBe(720)
    expect(cfg.width).toBe(1280)
  })

  it('선택 fps 라벨을 정수 fps로 전달한다', () => {
    expect(resolveMp4Config({ width: 100, height: 100 }, sel(480, '50fps')).fps).toBe(50)
    expect(resolveMp4Config({ width: 100, height: 100 }, sel(480, '15fps')).fps).toBe(15)
  })

  it('결정 문서의 권고 인코더 파라미터를 고정한다', () => {
    const cfg = resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '50fps'))
    expect(cfg.codec).toBe(MP4_CODEC)
    expect(MP4_CODEC).toBe('avc1.640033')
    expect(cfg.bitrateMode).toBe('quantizer')
    expect(cfg.latencyMode).toBe('quality')
    expect(cfg.hardwareAcceleration).toBe('prefer-hardware')
  })
})

describe('용량 경고 임계 판정 (AC4)', () => {
  const preset: ExportPreset = { ...DOORAY_GIF_PRESET, warnSizeBytes: 500 }

  it('sizeLimitBytes는 GIF 용량 임계를 돌려준다', () => {
    expect(sizeLimitBytes(preset)).toBe(500)
  })

  it('임계를 넘는 크기만 초과로 판정한다', () => {
    expect(exceedsSizeLimit(preset, 500)).toBe(false)
    expect(exceedsSizeLimit(preset, 501)).toBe(true)
  })
})
