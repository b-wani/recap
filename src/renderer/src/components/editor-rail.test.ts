import { describe, expect, it } from 'vitest'
import { isSection, RAIL_ITEMS, type RailId } from './editor-rail'

describe('editor rail items', () => {
  it('오디오만 비활성이고 나머지 도구는 활성', () => {
    for (const item of RAIL_ITEMS) {
      expect(Boolean(item.disabled)).toBe(item.id === 'audio')
    }
  })

  it('선택도구·커서·카메라·캡션·단축키·오디오를 이 순서로 담는다', () => {
    expect(RAIL_ITEMS.map((i) => i.id)).toEqual([
      'select',
      'cursor',
      'camera',
      'caption',
      'shortcuts',
      'audio'
    ])
  })

  it('isSection은 오디오만 섹션이 아니라고 본다', () => {
    const ids: RailId[] = RAIL_ITEMS.map((i) => i.id)
    expect(ids.filter(isSection)).toEqual(['select', 'cursor', 'camera', 'caption', 'shortcuts'])
  })
})
