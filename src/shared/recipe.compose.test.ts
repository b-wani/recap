import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { deriveRecipe, sampleComposition, COMPOSITE_DEFAULTS } from './recipe'
import type { EventTrack } from './event-track'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadTrack(name: string): EventTrack {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as EventTrack
}

// 원본 1000×800, 배율 2.0으로 유도한 레시피를 합성 파라미터로 샘플링한다.
const source = { width: 1000, height: 800 }
const recipe = deriveRecipe(loadTrack('event-track-clicks.json'), { source })

describe('합성 파라미터 샘플링: (렌더 레시피, 시각 t) → 프레임 합성 파라미터', () => {
  it('샘플링 출력에 카메라·배경/패딩·배지가 모두 담긴다', () => {
    const comp = sampleComposition(recipe, 0)
    // 카메라: 구간 밖이라 원본 그대로.
    expect(comp.camera).toEqual({ scale: 1, x: 500, y: 400 })
    // 배경/패딩: 기본값이 그대로 실린다.
    expect(comp.background).toEqual({
      color: COMPOSITE_DEFAULTS.backgroundColor,
      padding: COMPOSITE_DEFAULTS.padding
    })
    // 배지: 기본 on, 라벨은 녹화된 화면 크기.
    expect(comp.badge).toEqual({ visible: true, label: '1000×800' })
  })

  it('배지 라벨은 녹화된 화면 크기(source) 기준으로 합성된다', () => {
    const wide = deriveRecipe(loadTrack('event-track-clicks.json'), {
      source: { width: 2880, height: 1800 }
    })
    expect(sampleComposition(wide, 0).badge.label).toBe('2880×1800')
  })

  it('배지를 끄면 샘플링 출력에 off가 반영된다', () => {
    const off = { ...recipe, badge: { visible: false } }
    const comp = sampleComposition(off, 0)
    expect(comp.badge.visible).toBe(false)
    // off여도 라벨은 계산되어 있어, 켜는 순간 같은 문자열을 그린다.
    expect(comp.badge.label).toBe('1000×800')
  })

  it('배경/패딩을 조절하면 샘플링 출력에 그대로 반영된다', () => {
    const styled = { ...recipe, background: { color: '#000000', padding: 0.2 } }
    expect(sampleComposition(styled, 0).background).toEqual({ color: '#000000', padding: 0.2 })
  })

  it('배경/패딩·배지는 시각과 무관하게(줌 구간 안에서도) 합성 파라미터에 실린다', () => {
    // 완전 줌인 시점(구간0, t=1000)에서도 배경/패딩·배지가 그대로 담긴다.
    const comp = sampleComposition(recipe, 1000)
    expect(comp.camera.scale).toBe(2)
    expect(comp.background).toEqual({
      color: COMPOSITE_DEFAULTS.backgroundColor,
      padding: COMPOSITE_DEFAULTS.padding
    })
    expect(comp.badge).toEqual({ visible: true, label: '1000×800' })
  })
})
