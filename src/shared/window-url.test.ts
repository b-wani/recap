import { describe, it, expect } from 'vitest'
import { buildWindowHash, parseWindowHash, type WindowParams } from './window-url'

describe('window-url', () => {
  it('빌드→파싱 왕복이 값을 보존한다', () => {
    const params: WindowParams = { id: 7, role: 'editor' }
    const hash = buildWindowHash(params)
    expect(parseWindowHash(hash)).toEqual(params)
  })

  it('선행 # 가 있어도 파싱한다', () => {
    const hash = buildWindowHash({ id: 3, role: 'shell' })
    expect(parseWindowHash(`#${hash}`)).toEqual({ id: 3, role: 'shell' })
  })

  it('빈 해시는 null', () => {
    expect(parseWindowHash('')).toBeNull()
    expect(parseWindowHash('#')).toBeNull()
  })

  it('id·role 중 하나라도 없으면 null', () => {
    expect(parseWindowHash('id=3')).toBeNull()
    expect(parseWindowHash('role=editor')).toBeNull()
  })

  it('알 수 없는 role 은 null', () => {
    expect(parseWindowHash('id=3&role=nope')).toBeNull()
  })

  it('id 가 양의 정수가 아니면 null', () => {
    expect(parseWindowHash('id=0&role=shell')).toBeNull()
    expect(parseWindowHash('id=-1&role=shell')).toBeNull()
    expect(parseWindowHash('id=1.5&role=shell')).toBeNull()
    expect(parseWindowHash('id=abc&role=shell')).toBeNull()
  })

  it('모든 role 을 왕복한다', () => {
    for (const role of ['shell', 'toolbar', 'overlay', 'editor', 'library', 'welcome'] as const) {
      expect(parseWindowHash(buildWindowHash({ id: 1, role }))).toEqual({ id: 1, role })
    }
  })
})
