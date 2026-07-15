import { formatMB } from '../format'

/** 익스포트 진행 상태. 미리보기 패널의 하단 액션을 이 상태만 보고 그린다. export 출력은 GIF 단일. */
export type ExportStatus =
  | { phase: 'idle' }
  | { phase: 'encoding'; renderedFrames: number; totalFrames: number }
  | { phase: 'done'; path: string; sizeBytes: number; exceedsLimit: boolean }
  | { phase: 'error'; message: string }

/** 용량 경고 문구 — Dooray 본문 인라인 렌더 부담·뷰어 UX 기준(#118). */
const LIMIT_LABEL = 'Dooray 본문에 인라인으로 넣기엔 큰 용량'

/** 익스포트 액션(GIF) + 완료 후 Finder 열기·경로 복사·용량 경고 (AC1·2·3·4). */
export function ExportPanel({
  status,
  onExport
}: {
  status: ExportStatus
  onExport: () => void
}): JSX.Element {
  if (status.phase === 'encoding') {
    const pct =
      status.totalFrames > 0 ? Math.round((status.renderedFrames / status.totalFrames) * 100) : 0
    return (
      <div className="export-progress">
        <div className="export-progress-head">
          <span>GIF 익스포트 중…</span>
          <span>{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (status.phase === 'done') {
    return (
      <div className="export-done">
        <div className="export-done-head">
          <span>GIF 저장 완료</span>
          <span className="export-done-size">{formatMB(status.sizeBytes)}</span>
        </div>
        {status.exceedsLimit && <p className="export-warn">⚠ {LIMIT_LABEL}</p>}
        <div className="export-actions">
          <button className="btn btn-sm" onClick={() => window.recap.revealExport(status.path)}>
            Finder에서 열기
          </button>
          <button className="btn btn-sm" onClick={() => window.recap.copyExportPath(status.path)}>
            경로 복사
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="export-done">
      {status.phase === 'error' && <p className="export-warn">익스포트 실패: {status.message}</p>}
      <div className="export-buttons">
        <button className="btn btn-export" onClick={onExport}>
          GIF
        </button>
      </div>
    </div>
  )
}
