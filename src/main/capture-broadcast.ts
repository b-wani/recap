import type { WindowRole } from '../shared/window-url'

/**
 * 캡처 상태(`RecordingState`) 구독 role — 툴바·선택 오버레이·REC 알약만 받는다(#74).
 * 트레이는 창이 아니라 `applyState` 가 별도로 `appTray.update` 호출로 챙긴다.
 * shell 은 전환기의 idle/error 화면을 아직 이 상태로 그리므로 구독을 유지하고(#75로 preview 소멸),
 * editor·library·welcome 은 캡처 상태와 무관해 제외한다.
 */
const SUBSCRIBED_ROLES: ReadonlySet<WindowRole> = new Set(['shell', 'toolbar', 'overlay', 'rec-pill'])

/** 주어진 role 의 창이 캡처 상태 브로드캐스트 대상인지 판정한다. */
export function isSubscribedRole(role: WindowRole): boolean {
  return SUBSCRIBED_ROLES.has(role)
}
