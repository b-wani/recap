import type { WindowRole } from '../../../shared/window-url'

/**
 * 아직 전용 화면이 없는 role 창의 자리표시자. 창 레지스트리 골격(#69)이 부여한
 * id·role·컨텍스트가 렌더러까지 도달했음을 눈으로 확인시켜 주는 seam이다 —
 * editor(#75)·library(#78)·welcome(#80)·toolbar/overlay(#70~) 티켓이 각자 이 자리를 대체한다.
 */
export function PlaceholderView({
  id,
  role,
  context
}: {
  id: number
  role: WindowRole
  context: unknown
}): JSX.Element {
  return (
    <section className="placeholder">
      <p>
        <code>{role}</code> 창 (#{id}) — 아직 준비 중
      </p>
      <pre>{JSON.stringify(context, null, 2)}</pre>
    </section>
  )
}
