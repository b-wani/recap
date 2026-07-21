import { describe, it, expect } from 'vitest'
import {
  QUALITY_TIERS,
  TIER_LABELS,
  tierDescription,
  MP4_HEIGHTS,
  GIF_HEIGHTS,
  heightsForFormat,
  sizeLabel,
  GIF_FPS_OPTIONS,
  MP4_FPS_LABELS,
  fpsLabelsForFormat,
  MP4_TIER_QP,
  GIF_TIER_POLICY,
  DEFAULT_SELECTION,
  defaultSelectionForFormat,
  reconcileSelectionForFormat,
  defaultHeightForSource,
  resolveGifConfig,
  resolveMp4Config,
  MP4_CODEC,
  fpsFromLabel,
  extensionForFormat,
  estimateMp4Bytes,
  estimateGifBytes,
  estimateExportSeconds,
  exceedsSizeLimit,
  DOORAY_WARN_BYTES,
  type ExportSelection
} from './export-preset'

const sel = (height: number, fps: string, tier: ExportSelection['tier']): ExportSelection => ({
  height,
  fps,
  tier
})

describe('ExportFormat: 포맷 차원 (#155/#159)', () => {
  it('확장자는 포맷 문자열과 같다(export.{ext})', () => {
    expect(extensionForFormat('gif')).toBe('gif')
    expect(extensionForFormat('mp4')).toBe('mp4')
  })
})

describe('품질 티어: Screen Studio 4티어 (#146)', () => {
  it('티어는 studio/social/web/web-low 4종, SS 라벨 문자 그대로', () => {
    expect(QUALITY_TIERS).toEqual(['studio', 'social', 'web', 'web-low'])
    expect(TIER_LABELS.studio).toBe('Studio')
    expect(TIER_LABELS.social).toBe('Social Media')
    expect(TIER_LABELS.web).toBe('Web')
    expect(TIER_LABELS['web-low']).toBe('Web (Low)')
  })

  it('MP4 티어=QP 18/23/28/32', () => {
    expect(MP4_TIER_QP).toEqual({ studio: 18, social: 23, web: 28, 'web-low': 32 })
  })

  it('GIF 티어=색 수 256→64, Bayer 디더는 Studio 전용', () => {
    expect(GIF_TIER_POLICY.studio).toEqual({ maxColors: 256, dither: 16 })
    expect(GIF_TIER_POLICY.social).toEqual({ maxColors: 256, dither: 0 })
    expect(GIF_TIER_POLICY.web).toEqual({ maxColors: 128, dither: 0 })
    expect(GIF_TIER_POLICY['web-low']).toEqual({ maxColors: 64, dither: 0 })
  })

  it('디더가 켜지는 티어는 Studio 하나뿐이다', () => {
    const dithered = QUALITY_TIERS.filter((t) => GIF_TIER_POLICY[t].dither > 0)
    expect(dithered).toEqual(['studio'])
  })

  it('설명문은 포맷·티어별로 있고 GIF Studio는 디더 비용을 명시한다', () => {
    expect(tierDescription('mp4', 'studio')).toMatch(/재편집/)
    expect(tierDescription('gif', 'studio')).toMatch(/디더/)
  })
})

describe('포맷별 프레임레이트 게이팅: 60fps는 MP4 전용, GIF 상한 50fps (#146 §2)', () => {
  it('MP4 fps는 60/30/24', () => {
    expect(MP4_FPS_LABELS).toEqual(['60fps', '30fps', '24fps'])
  })

  it('GIF fps는 50/30/25/20/15 + delayCs 2/3/4/5/7', () => {
    expect(GIF_FPS_OPTIONS.map((o) => o.label)).toEqual(['50fps', '30fps', '25fps', '20fps', '15fps'])
    expect(GIF_FPS_OPTIONS.map((o) => o.delayCs)).toEqual([2, 3, 4, 5, 7])
  })

  it('60fps는 MP4 옵션에만 있고 GIF 옵션엔 없다', () => {
    expect(fpsLabelsForFormat('mp4')).toContain('60fps')
    expect(fpsLabelsForFormat('gif')).not.toContain('60fps')
  })
})

describe('포맷별 출력 해상도 게이팅: GIF 상한 1080p, 4K는 MP4 전용 (#146 §2)', () => {
  it('MP4는 720/1080/4K, GIF는 720/1080', () => {
    expect(MP4_HEIGHTS).toEqual([720, 1080, 2160])
    expect(GIF_HEIGHTS).toEqual([720, 1080])
    expect(heightsForFormat('mp4')).toContain(2160)
    expect(heightsForFormat('gif')).not.toContain(2160)
  })

  it('2160은 4K로 표기한다', () => {
    expect(sizeLabel(2160)).toBe('4K')
    expect(sizeLabel(1080)).toBe('1080p')
  })
})

describe('선택 기본값·재조정', () => {
  it('렌더러 기본은 GIF/720p/50fps/Social(디더 없음이 전역 기본)', () => {
    expect(DEFAULT_SELECTION).toEqual({ height: 720, fps: '50fps', tier: 'social' })
  })

  it('MP4 기본은 1080p/60fps/Studio', () => {
    expect(defaultSelectionForFormat('mp4')).toEqual({ height: 1080, fps: '60fps', tier: 'studio' })
  })

  it('MP4(60fps/4K)→GIF 전환 시 fps·해상도를 GIF 허용값으로 되돌리고 티어는 유지한다', () => {
    const mp4Sel = sel(2160, '60fps', 'web')
    const gifSel = reconcileSelectionForFormat('gif', mp4Sel)
    expect(gifSel.fps).toBe('50fps')
    expect(gifSel.height).toBe(720)
    expect(gifSel.tier).toBe('web')
  })

  it('이미 유효한 선택은 그대로 둔다', () => {
    const s = sel(1080, '30fps', 'studio')
    expect(reconcileSelectionForFormat('mp4', s)).toEqual(s)
  })
})

describe('defaultHeightForSource: 원본 상한 안에서의 기본 해상도', () => {
  it('GIF는 원본이 720p 이상이면 기본 720p', () => {
    expect(defaultHeightForSource('gif', 1080)).toBe(720)
    expect(defaultHeightForSource('gif', 720)).toBe(720)
  })

  it('MP4는 원본이 1080p 이상이면 기본 1080p', () => {
    expect(defaultHeightForSource('mp4', 2160)).toBe(1080)
    expect(defaultHeightForSource('mp4', 1080)).toBe(1080)
  })

  it('원본이 모든 옵션보다 작으면 최소 옵션으로 폴백(출력은 원본으로 캡)', () => {
    expect(defaultHeightForSource('gif', 600)).toBe(720)
    expect(defaultHeightForSource('mp4', 600)).toBe(720)
  })
})

describe('resolveGifConfig: (원본, 선택) → GIF 인코딩 설정', () => {
  it('선택 해상도로 비율 유지 축소하고 티어의 색 수·디더를 담는다', () => {
    const cfg = resolveGifConfig({ width: 2880, height: 1800 }, sel(720, '50fps', 'social'))
    expect(cfg.height).toBe(720)
    expect(cfg.width).toBe(1152)
    expect(cfg.maxColors).toBe(256)
    expect(cfg.dither).toBe(0)
  })

  it('Studio 티어는 Bayer 디더(spread 16)를 켠다', () => {
    const cfg = resolveGifConfig({ width: 1280, height: 720 }, sel(720, '50fps', 'studio'))
    expect(cfg.dither).toBe(16)
    expect(cfg.maxColors).toBe(256)
  })

  it('Web (Low)은 64색·디더 없음', () => {
    const cfg = resolveGifConfig({ width: 1280, height: 720 }, sel(720, '50fps', 'web-low'))
    expect(cfg.maxColors).toBe(64)
    expect(cfg.dither).toBe(0)
  })

  it('원본을 초과하는 선택은 원본으로 캡한다(업스케일 금지)', () => {
    const cfg = resolveGifConfig({ width: 1280, height: 720 }, sel(1080, '50fps', 'social'))
    expect(cfg.height).toBe(720)
    expect(cfg.width).toBe(1280)
  })

  it('선택 fps를 delayCs로 전달한다', () => {
    expect(resolveGifConfig({ width: 100, height: 100 }, sel(720, '50fps', 'social')).delayCs).toBe(2)
    expect(resolveGifConfig({ width: 100, height: 100 }, sel(720, '15fps', 'social')).delayCs).toBe(7)
  })
})

describe('resolveMp4Config: (원본, 선택) → MP4 인코딩 설정', () => {
  it('선택 해상도로 비율 유지 축소하되 짝수 치수로 맞춘다(H.264 제약)', () => {
    const cfg = resolveMp4Config({ width: 2880, height: 1800 }, sel(720, '60fps', 'studio'))
    expect(cfg.width).toBe(1152)
    expect(cfg.height).toBe(720)
  })

  it('홀수로 떨어지는 치수를 짝수로 정렬한다', () => {
    const cfg = resolveMp4Config({ width: 1365, height: 767 }, sel(720, '60fps', 'studio'))
    expect(cfg.height % 2).toBe(0)
    expect(cfg.width % 2).toBe(0)
  })

  it('티어별 QP를 담는다(Studio=18, Web (Low)=32)', () => {
    expect(resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '60fps', 'studio')).qp).toBe(18)
    expect(resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '60fps', 'web-low')).qp).toBe(32)
  })

  it('결정 문서의 권고 인코더 파라미터를 고정한다', () => {
    const cfg = resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '60fps', 'studio'))
    expect(cfg.codec).toBe(MP4_CODEC)
    expect(MP4_CODEC).toBe('avc1.640033')
    expect(cfg.bitrateMode).toBe('quantizer')
    expect(cfg.latencyMode).toBe('quality')
    expect(cfg.hardwareAcceleration).toBe('prefer-hardware')
  })

  it('선택 fps 라벨을 정수 fps로 전달한다', () => {
    expect(resolveMp4Config({ width: 100, height: 100 }, sel(720, '60fps', 'studio')).fps).toBe(60)
    expect(resolveMp4Config({ width: 100, height: 100 }, sel(720, '24fps', 'studio')).fps).toBe(24)
  })
})

describe('fpsFromLabel: MP4는 라벨 표기값을 목표 fps로 쓴다', () => {
  it('옵션 라벨의 정수 표기를 그대로 fps로 돌려준다', () => {
    expect(fpsFromLabel('60fps')).toBe(60)
    expect(fpsFromLabel('24fps')).toBe(24)
  })

  it('파싱 불가 라벨은 첫 MP4 옵션(60fps)으로 폴백한다', () => {
    expect(fpsFromLabel('nope')).toBe(60)
  })
})

describe('사전 추정치: 예상 최대 용량·시간 (#159 AC7)', () => {
  it('MP4 예상 용량은 고화질 티어일수록 크다', () => {
    const cfgStudio = resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '60fps', 'studio'))
    const cfgLow = resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '60fps', 'web-low'))
    expect(estimateMp4Bytes(cfgStudio, 5000, 'studio')).toBeGreaterThan(
      estimateMp4Bytes(cfgLow, 5000, 'web-low')
    )
  })

  it('GIF 예상 용량은 디더가 켜지면 크게 늘고 색 수↓면 준다', () => {
    const source = { width: 1920, height: 1080 }
    const studio = estimateGifBytes(resolveGifConfig(source, sel(1080, '50fps', 'studio')), 5000)
    const social = estimateGifBytes(resolveGifConfig(source, sel(1080, '50fps', 'social')), 5000)
    const low = estimateGifBytes(resolveGifConfig(source, sel(1080, '50fps', 'web-low')), 5000)
    expect(studio).toBeGreaterThan(social)
    expect(social).toBeGreaterThan(low)
  })

  it('예상 시간은 최소 1초 이상 정수 초', () => {
    const cfg = resolveMp4Config({ width: 1920, height: 1080 }, sel(1080, '60fps', 'studio'))
    const secs = estimateExportSeconds('mp4', cfg, 3000)
    expect(secs).toBeGreaterThanOrEqual(1)
    expect(Number.isInteger(secs)).toBe(true)
  })
})

describe('Dooray 용량 경고 임계 (#118)', () => {
  it('임계는 25MB', () => {
    expect(DOORAY_WARN_BYTES).toBe(25 * 1024 * 1024)
  })

  it('임계를 넘는 크기만 초과로 판정한다', () => {
    expect(exceedsSizeLimit(DOORAY_WARN_BYTES)).toBe(false)
    expect(exceedsSizeLimit(DOORAY_WARN_BYTES + 1)).toBe(true)
  })
})
