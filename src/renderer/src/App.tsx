import { useEffect, useMemo, useState } from 'react'
import type { EditorContext, OverlayContext } from '../../shared/ipc'
import { parseWindowHash } from '../../shared/window-url'
import { EditorView } from './views/EditorView'
import { LibraryView } from './views/LibraryView'
import { WelcomeView } from './views/WelcomeView'
import { PlaceholderView } from './views/PlaceholderView'
import { ToolbarView } from './views/ToolbarView'
import { RecPillView } from './views/RecPillView'
import { WindowPickerOverlayView } from './views/WindowPickerOverlayView'
import { AreaOverlayView } from './views/AreaOverlayView'
import { DisplayOverlayView } from './views/DisplayOverlayView'

export default function App(): JSX.Element {
  // 이 창의 정체(id·role) — main 이 URL 해시로 실어 준다(#69). 모든 창이 이 경로로
  // 생성되므로 해시가 없거나 못 읽으면 아무것도 그리지 않는다.
  const params = useMemo(() => parseWindowHash(window.location.hash), [])
  const role = params?.role ?? null

  // main 이 창에 넣어 둔 초기 컨텍스트를 id 로 당겨온다(pull 모델).
  const [context, setContext] = useState<unknown>(null)
  useEffect(() => {
    if (params) void window.recap.getWindowContext(params.id).then(setContext)
  }, [params])

  // 캡처 툴바 창(#70) — 프레임 없는 플로팅 pill 이라 .app 크롬 없이 자체 루트로 그린다.
  if (role === 'toolbar') {
    return <ToolbarView />
  }

  // Welcome(온보딩) 창(#80) — 독립 창으로 분리되어 셸을 직접 그린다. 완료 플래그
  // 판정·자동/수동 소환·완료 후 창 닫힘은 모두 main이 맡는다.
  if (role === 'welcome') {
    return <WelcomeView />
  }

  // 플로팅 REC 알약(#74) — 녹화 중에만 뜨는 별도 표면. 자체 pill 크롬을 그린다.
  if (role === 'rec-pill') {
    return <RecPillView />
  }

  // 선택 오버레이 창 — 컨텍스트의 kind 로 Display(#71)/Window picker(#73)/Area(#72)를
  // 분기한다. 화면 전체를 덮는 딤 창이라 .app 크롬 없이 그린다. 컨텍스트 도착 전엔 아무것도 안 그린다.
  if (role === 'overlay' && params) {
    const overlay = context as OverlayContext | null
    if (overlay?.kind === 'display') return <DisplayOverlayView context={overlay} />
    if (overlay?.kind === 'area') return <AreaOverlayView />
    if (overlay?.kind === 'window-picker') return <WindowPickerOverlayView windowId={params.id} />
    return <></>
  }

  // 에디터 창(#75) — 독립 문서창, 컨텍스트(연 녹화물 + recipe 편집분)를 창 로컬로 소유하고
  // 전역 캡처 상태는 구독하지 않는다. 컨텍스트 도착 전엔 아무것도 안 그린다.
  if (role === 'editor') {
    const editorContext = context as EditorContext | null
    if (!editorContext) return <></>
    return <EditorView context={editorContext} />
  }

  // 라이브러리 창(#78) — 녹화 전체를 브라우즈하는 독립 창. 캡처 상태와 무관하고
  // 컨텍스트도 쓰지 않는다(마운트 시 listRecordings로 직접 로드).
  if (role === 'library') {
    return <LibraryView />
  }

  // 그 밖의 아직 전용 화면이 없는 role 창은 자리표시자로 골격이 닿았음을 보인다.
  if (role !== null) {
    return (
      <main className="app">
        <PlaceholderView id={params?.id ?? 0} role={role} context={context} />
      </main>
    )
  }

  // 창 파라미터가 없는 창은 없다 — 정체를 모르는 창은 빈 화면으로 둔다.
  return <></>
}
