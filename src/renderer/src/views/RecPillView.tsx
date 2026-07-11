import { useEffect, useState } from 'react'
import type { RecordingState } from '../../../shared/ipc'
import { formatElapsed } from '../format'

/**
 * 플로팅 REC 알약(#74) — 녹화 중에만 뜨는 별도 표면. 툴바가 녹화 시작 시 닫히므로
 * (#54) 표시·정지는 이 창이 맡는다. rec 성역(점 + SF Mono 타임코드) + 정지 버튼만
 * 담고, 마스코트는 넣지 않는다.
 */
export function RecPillView(): JSX.Element {
  const [state, setState] = useState<RecordingState>({ status: 'idle' })
  useEffect(() => window.recap.onStateChange(setState), [])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const startedAt = state.status === 'recording' ? state.startedAt : now

  return (
    <div className="rec-pill">
      <span className="rec-dot" aria-hidden />
      <span className="rec-time">{formatElapsed(now - startedAt)}</span>
      <button className="btn btn-stop rec-pill-stop" onClick={() => void window.recap.stop()}>
        ■ 정지
      </button>
    </div>
  )
}
