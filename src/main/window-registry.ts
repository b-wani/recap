import type { WindowRole } from '../shared/window-url'

/**
 * 등록된 창 하나. `context` 는 창 생성 시 main 이 넣어 두는 초기 페이로드로,
 * 렌더러가 `window:get-context` 로 당겨간다(에디터는 이걸로 녹화 데이터를 로드 — #75).
 */
export interface WindowEntry<W = unknown> {
  id: number
  role: WindowRole
  window: W
  context: unknown
}

/**
 * 열려 있는 창들의 단일 대장. 단일 `mainWindow` 전역(구 `index.ts`)을 대체하며,
 * main 이 role 별로 창을 지목해 메시지를 보내거나 컨텍스트를 돌려주는 근거가 된다(#64).
 *
 * Electron 에 의존하지 않도록 창 핸들 타입 `W` 를 제네릭으로 둔다 — main 은
 * `WindowRegistry<BrowserWindow>` 로 쓰고, 테스트는 가짜 핸들로 검증한다.
 */
export class WindowRegistry<W = unknown> {
  private readonly entries = new Map<number, WindowEntry<W>>()
  private nextId = 1

  /** 창을 등록하고 새 `windowId` 를 부여한다. id 는 1부터 단조 증가하며 재사용하지 않는다. */
  create(role: WindowRole, window: W, context: unknown = null): WindowEntry<W> {
    const entry: WindowEntry<W> = { id: this.nextId++, role, window, context }
    this.entries.set(entry.id, entry)
    return entry
  }

  get(id: number): WindowEntry<W> | undefined {
    return this.entries.get(id)
  }

  /** 해당 role 의 등록 창 전부(에디터처럼 다중 인스턴스 role 조회용). 등록 순서. */
  allByRole(role: WindowRole): WindowEntry<W>[] {
    return [...this.entries.values()].filter((e) => e.role === role)
  }

  /** 해당 role 의 첫 등록 창(shell·library·welcome 처럼 싱글톤 role 의 focus-if-exists 근거). */
  firstByRole(role: WindowRole): WindowEntry<W> | undefined {
    for (const entry of this.entries.values()) {
      if (entry.role === role) return entry
    }
    return undefined
  }

  /** 등록된 모든 창(상태 브로드캐스트 대상 순회용 — #74). 등록 순서. */
  all(): WindowEntry<W>[] {
    return [...this.entries.values()]
  }

  /** 창의 초기 컨텍스트를 갱신한다(창 수명 중 페이로드가 바뀌는 경우). */
  setContext(id: number, context: unknown): void {
    const entry = this.entries.get(id)
    if (entry) entry.context = context
  }

  /** 창을 대장에서 제거한다. 창이 실제로 닫힐(destroy) 때 호출한다. */
  remove(id: number): void {
    this.entries.delete(id)
  }
}
