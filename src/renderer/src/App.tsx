import { useEffect, useMemo, useState } from 'react'
import type { RecordingState } from '../../shared/ipc'
import { parseWindowHash } from '../../shared/window-url'
import { IdleView } from './views/IdleView'
import { RecordingView } from './views/RecordingView'
import { PreviewView } from './views/PreviewView'
import { ErrorView } from './views/ErrorView'
import { WelcomeView } from './views/WelcomeView'
import { PlaceholderView } from './views/PlaceholderView'
import { ToolbarView } from './views/ToolbarView'

export default function App(): JSX.Element {
  // 이 창의 정체(id·role) — main 이 URL 해시로 실어 준다(#69). 없으면(구 진입 경로 등)
  // 전환기 통합 창인 shell 로 폴백한다.
  const params = useMemo(() => parseWindowHash(window.location.hash), [])
  const role = params?.role ?? 'shell'

  // main 이 창에 넣어 둔 초기 컨텍스트를 id 로 당겨온다(pull 모델). shell 은 아직 안 쓴다.
  const [context, setContext] = useState<unknown>(null)
  useEffect(() => {
    if (params) void window.recap.getWindowContext(params.id).then(setContext)
  }, [params])

  const [state, setState] = useState<RecordingState>({ status: 'idle' })

  useEffect(() => window.recap.onStateChange(setState), [])

  const goIdle = (): void => setState({ status: 'idle' })

  // 캡처 툴바 창(#70) — 프레임 없는 플로팅 pill 이라 .app 크롬 없이 자체 루트로 그린다.
  if (role === 'toolbar') {
    return <ToolbarView />
  }

  // Welcome(온보딩) 창(#80) — 독립 창으로 분리되어 셸을 직접 그린다. 완료 플래그
  // 판정·자동/수동 소환·완료 후 창 닫힘은 모두 main이 맡는다.
  if (role === 'welcome') {
    return <WelcomeView />
  }

  // 그 밖의 아직 전용 화면이 없는 role 창은 자리표시자로 골격이 닿았음을 보인다.
  if (role !== 'shell') {
    return (
      <main className="app">
        <PlaceholderView id={params?.id ?? 0} role={role} context={context} />
      </main>
    )
  }

  return (
    <main className="app">
      <h1 className="title">Recap</h1>
      {state.status === 'idle' && <IdleView />}
      {state.status === 'recording' && <RecordingView state={state} />}
      {state.status === 'preview' && <PreviewView state={state} onExit={goIdle} />}
      {state.status === 'error' && <ErrorView state={state} onReset={goIdle} />}
    </main>
  )
}
