import { describe, it, expect } from 'vitest'
import { serializePresets, parsePresets } from './style-preset.persist'
import type { StylePreset } from './style-preset'

const preset: StylePreset = {
  id: 'preset-1',
  name: '슬레이트',
  background: {
    type: 'gradient',
    color: '#1c1c1e',
    gradient: { angle: 145, stops: ['#2b2b30', '#161618'] },
    padding: 0.08,
    cornerRadius: 12,
    shadow: 0.45
  },
  cursor: { size: 1, smoothingMs: 120 }
}

describe('스타일 프리셋 직렬화: 왕복', () => {
  it('직렬화 후 파싱하면 동일한 목록을 돌려준다', () => {
    const text = serializePresets([preset])
    expect(parsePresets(text)).toEqual([preset])
  })

  it('빈 목록도 왕복한다', () => {
    expect(parsePresets(serializePresets([]))).toEqual([])
  })
})

describe('스타일 프리셋 파싱: 손상 내성', () => {
  it('JSON이 아니면 빈 목록', () => {
    expect(parsePresets('not json')).toEqual([])
  })

  it('formatVersion이 다르면 빈 목록', () => {
    expect(parsePresets(JSON.stringify({ formatVersion: 999, presets: [preset] }))).toEqual([])
  })

  it('presets가 배열이 아니면 빈 목록', () => {
    expect(parsePresets(JSON.stringify({ formatVersion: 1, presets: 'nope' }))).toEqual([])
  })

  it('목록 안 손상된 항목 하나만 건너뛰고 나머지는 살린다', () => {
    const text = JSON.stringify({
      formatVersion: 1,
      presets: [preset, { id: 'broken', name: '깨짐' /* background 없음 */ }]
    })
    expect(parsePresets(text)).toEqual([preset])
  })
})
