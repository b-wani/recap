import { useEffect, useState } from 'react'
import type { RecordingState } from '../../../shared/ipc'
import { formatElapsed } from '../format'

export function RecordingView({
  state
}: {
  state: Extract<RecordingState, { status: 'recording' }>
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <section className="panel recording">
      <div className="rec-indicator">
        <span className="rec-dot" aria-hidden />
        <span className="rec-label">녹화 중</span>
      </div>
      <span className="rec-time">{formatElapsed(now - state.startedAt)}</span>
      <p className="hint">
        {state.target.kind === 'display' ? '전체 화면' : '창'}: {state.target.title} · 마우스 이벤트{' '}
        {state.eventCount}개 기록됨
      </p>
      <button className="btn btn-stop" onClick={() => window.hoppy.stop()}>
        ■ 정지
      </button>
    </section>
  )
}
