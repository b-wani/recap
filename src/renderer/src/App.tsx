import { useEffect, useState } from 'react'
import type { RecordingState } from '../../shared/ipc'
import { IdleView } from './views/IdleView'
import { RecordingView } from './views/RecordingView'
import { PreviewView } from './views/PreviewView'
import { ErrorView } from './views/ErrorView'

export default function App(): JSX.Element {
  const [state, setState] = useState<RecordingState>({ status: 'idle' })

  useEffect(() => window.recap.onStateChange(setState), [])

  const goIdle = (): void => setState({ status: 'idle' })

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
