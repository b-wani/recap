import { useEffect, useMemo, useState } from 'react'
import type { RecordingState } from '../../shared/ipc'
import { parseWindowHash } from '../../shared/window-url'
import { IdleView } from './views/IdleView'
import { RecordingView } from './views/RecordingView'
import { PreviewView } from './views/PreviewView'
import { ErrorView } from './views/ErrorView'
import { OnboardingView } from './views/OnboardingView'
import { PlaceholderView } from './views/PlaceholderView'

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

  // 온보딩 완료 여부. null은 조회 전(로딩) — 확정되기 전엔 아무 화면도 그리지 않는다.
  // 온보딩은 녹화 상태 머신(RecordingState)과 직교라 여기 최상단에서 감싼다.
  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [state, setState] = useState<RecordingState>({ status: 'idle' })

  useEffect(() => window.recap.onStateChange(setState), [])
  useEffect(() => {
    void window.recap.onboardingStatus().then(setOnboarded)
  }, [])

  const goIdle = (): void => setState({ status: 'idle' })

  // shell 이 아닌 role 창은 아직 전용 화면이 없다 — 자리표시자로 골격이 닿았음을 보인다.
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
      {onboarded === false ? (
        // 완료 시 onboarded=true가 되고, state는 기본값 idle이라 그 자리에서 idle 화면으로 전환된다.
        <OnboardingView onComplete={() => setOnboarded(true)} />
      ) : onboarded === true ? (
        <>
          {state.status === 'idle' && <IdleView />}
          {state.status === 'recording' && <RecordingView state={state} />}
          {state.status === 'preview' && <PreviewView state={state} onExit={goIdle} />}
          {state.status === 'error' && <ErrorView state={state} onReset={goIdle} />}
        </>
      ) : null}
    </main>
  )
}
