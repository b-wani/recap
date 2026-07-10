import { describe, it, expect } from 'vitest'
import { isSubscribedRole } from './capture-broadcast'
import type { WindowRole } from '../shared/window-url'

describe('isSubscribedRole', () => {
  it('툴바·오버레이·REC 알약·shell 은 구독 대상이다', () => {
    const subscribed: WindowRole[] = ['toolbar', 'overlay', 'rec-pill', 'shell']
    for (const role of subscribed) {
      expect(isSubscribedRole(role)).toBe(true)
    }
  })

  it('editor·library·welcome 은 구독 대상이 아니다', () => {
    const excluded: WindowRole[] = ['editor', 'library', 'welcome']
    for (const role of excluded) {
      expect(isSubscribedRole(role)).toBe(false)
    }
  })
})
