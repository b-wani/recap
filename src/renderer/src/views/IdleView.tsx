import { useEffect, useState } from 'react'
import type { CaptureTarget, RecordingSummary } from '../../../shared/ipc'
import { formatDate, formatElapsed } from '../format'

export function IdleView(): JSX.Element {
  const [targets, setTargets] = useState<CaptureTarget[] | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecordingSummary[]>([])

  const loadTargets = (): void => {
    setLoadError(null)
    setTargets(null)
    window.recap
      .listTargets()
      .then((list) => {
        setTargets(list)
        setSelectedId((prev) => (list.some((t) => t.id === prev) ? prev : (list[0]?.id ?? '')))
      })
      .catch((err: Error) => setLoadError(err.message))
  }

  useEffect(loadTargets, [])

  // 앱 시작 시 로컬에 저장된 최근 녹화를 불러온다 (재시작 후 다시 열기).
  useEffect(() => {
    window.recap.listRecordings().then(setRecent)
  }, [])

  if (loadError) {
    return (
      <section className="panel">
        <p className="hint">캡처 대상을 불러오지 못했습니다.</p>
        <p className="err-message">{loadError}</p>
        <button className="btn" onClick={loadTargets}>
          다시 불러오기
        </button>
      </section>
    )
  }

  if (targets === null) {
    return (
      <section className="panel">
        <p className="hint">캡처 대상을 불러오는 중…</p>
      </section>
    )
  }

  const displays = targets.filter((t) => t.kind === 'display')
  const windows = targets.filter((t) => t.kind === 'window')

  return (
    <section className="panel">
      <p className="hint">녹화할 대상을 고르세요 (전체 화면 또는 특정 창).</p>
      <div className="picker">
        <TargetGroup
          title="화면"
          targets={displays}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <TargetGroup
          title="창"
          targets={windows}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <button
        className="btn btn-record"
        disabled={selectedId === ''}
        onClick={() => window.recap.start(selectedId)}
      >
        ● 녹화 시작
      </button>
      {recent.length > 0 && (
        <div className="recent">
          <h2 className="recent-title">최근 녹화</h2>
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.folder}>
                <button className="recent-item" onClick={() => window.recap.openRecording(r.folder)}>
                  <span className="recent-name">{formatDate(r.startedAt)}</span>
                  <span className="recent-meta">
                    {formatElapsed(r.durationMs)} · 이벤트 {r.eventCount}개
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** 캡처 대상 그룹(화면/창) — 클릭 선택 카드 리스트. 대상이 없으면 그리지 않는다. */
function TargetGroup({
  title,
  targets,
  selectedId,
  onSelect
}: {
  title: string
  targets: CaptureTarget[]
  selectedId: string
  onSelect: (id: string) => void
}): JSX.Element | null {
  if (targets.length === 0) return null
  return (
    <div className="picker-group">
      <h2 className="picker-group-title">{title}</h2>
      <ul className="picker-list">
        {targets.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`target-card${t.id === selectedId ? ' is-selected' : ''}`}
              aria-pressed={t.id === selectedId}
              onClick={() => onSelect(t.id)}
            >
              <span className="target-card-icon" aria-hidden>
                {t.kind === 'display' ? '🖥' : '🪟'}
              </span>
              <span className="target-card-body">
                <span className="target-card-title">{t.title}</span>
                <span className="target-card-dim">
                  {Math.round(t.width)}×{Math.round(t.height)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
