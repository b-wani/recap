import { describe, it, expect } from 'vitest'
import { WindowRegistry } from './window-registry'

/** 가짜 창 핸들 — 레지스트리는 핸들 내용을 들여다보지 않으므로 식별용 태그면 충분하다. */
interface FakeWin {
  tag: string
}

describe('WindowRegistry', () => {
  it('create 는 1부터 단조 증가하는 고유 id 를 부여한다', () => {
    const reg = new WindowRegistry<FakeWin>()
    const a = reg.create('shell', { tag: 'a' })
    const b = reg.create('editor', { tag: 'b' })
    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
  })

  it('get 은 등록한 엔트리를 돌려준다', () => {
    const reg = new WindowRegistry<FakeWin>()
    const entry = reg.create('editor', { tag: 'x' }, { folder: '/rec/1' })
    expect(reg.get(entry.id)).toEqual({
      id: entry.id,
      role: 'editor',
      window: { tag: 'x' },
      context: { folder: '/rec/1' }
    })
  })

  it('context 를 안 주면 null 로 등록한다', () => {
    const reg = new WindowRegistry<FakeWin>()
    const entry = reg.create('shell', { tag: 's' })
    expect(entry.context).toBeNull()
  })

  it('allByRole 은 같은 role 을 등록 순서로 전부 준다(에디터 다중)', () => {
    const reg = new WindowRegistry<FakeWin>()
    const e1 = reg.create('editor', { tag: 'e1' })
    reg.create('library', { tag: 'lib' })
    const e2 = reg.create('editor', { tag: 'e2' })
    expect(reg.allByRole('editor').map((e) => e.id)).toEqual([e1.id, e2.id])
    expect(reg.allByRole('toolbar')).toEqual([])
  })

  it('firstByRole 은 싱글톤 role 의 첫 창을 준다', () => {
    const reg = new WindowRegistry<FakeWin>()
    reg.create('editor', { tag: 'e' })
    const lib = reg.create('library', { tag: 'lib' })
    expect(reg.firstByRole('library')?.id).toBe(lib.id)
    expect(reg.firstByRole('welcome')).toBeUndefined()
  })

  it('setContext 는 엔트리 컨텍스트를 갱신한다', () => {
    const reg = new WindowRegistry<FakeWin>()
    const entry = reg.create('editor', { tag: 'e' })
    reg.setContext(entry.id, { folder: '/rec/2' })
    expect(reg.get(entry.id)?.context).toEqual({ folder: '/rec/2' })
  })

  it('remove 후 get 은 undefined, id 는 재사용되지 않는다', () => {
    const reg = new WindowRegistry<FakeWin>()
    const a = reg.create('shell', { tag: 'a' })
    reg.remove(a.id)
    expect(reg.get(a.id)).toBeUndefined()
    const b = reg.create('shell', { tag: 'b' })
    expect(b.id).toBe(2)
  })

  it('all 은 등록된 전부를 등록 순서로 준다', () => {
    const reg = new WindowRegistry<FakeWin>()
    const a = reg.create('shell', { tag: 'a' })
    const b = reg.create('editor', { tag: 'b' })
    expect(reg.all().map((e) => e.id)).toEqual([a.id, b.id])
  })
})
