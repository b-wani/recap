/**
 * 창 부트스트랩 계약 — main 이 창을 만들 때 부여한 `windowId` 와 `role` 을
 * 렌더러에 URL 해시로 실어 보내고, 렌더러가 부팅 시 읽는다. 큰 페이로드는
 * 여기 싣지 않고, 렌더러가 id 로 `window:get-context` 를 당겨온다(#64 pull 모델).
 */

/**
 * 창의 역할 — 확정 토폴로지(#54)의 5종(toolbar·overlay·editor·library·welcome)에
 * 녹화 중에만 뜨는 플로팅 REC 알약 `rec-pill`(경과 타임코드 + 정지, #74)을 더한 구성.
 */
export type WindowRole = 'toolbar' | 'overlay' | 'rec-pill' | 'editor' | 'library' | 'welcome'

const ROLES: readonly WindowRole[] = [
  'toolbar',
  'overlay',
  'rec-pill',
  'editor',
  'library',
  'welcome'
]

export interface WindowParams {
  id: number
  role: WindowRole
}

function isRole(value: string): value is WindowRole {
  return (ROLES as readonly string[]).includes(value)
}

/** `id`·`role` 을 URL 해시 조각(`id=3&role=editor`, 선행 `#` 없음)으로 만든다. */
export function buildWindowHash(params: WindowParams): string {
  const search = new URLSearchParams({ id: String(params.id), role: params.role })
  return search.toString()
}

/**
 * 위치 해시에서 창 파라미터를 읽는다. 선행 `#` 유무 모두 허용. id 가 양의 정수가
 * 아니거나 role 이 알 수 없는 값이면 `null`(렌더러는 아무것도 그리지 않는다).
 */
export function parseWindowHash(hash: string): WindowParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw.length === 0) return null
  const search = new URLSearchParams(raw)
  const idRaw = search.get('id')
  const roleRaw = search.get('role')
  if (idRaw === null || roleRaw === null) return null
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id <= 0) return null
  if (!isRole(roleRaw)) return null
  return { id, role: roleRaw }
}
