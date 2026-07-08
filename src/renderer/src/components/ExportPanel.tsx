import { type ExportFormat } from '../../../shared/export-preset'
import { formatMB } from '../format'

/** 익스포트 진행 상태. 미리보기 패널의 하단 액션을 이 상태만 보고 그린다. */
export type ExportStatus =
  | { phase: 'idle' }
  | { phase: 'encoding'; format: ExportFormat; renderedFrames: number; totalFrames: number }
  | { phase: 'done'; format: ExportFormat; path: string; sizeBytes: number; exceedsLimit: boolean }
  | { phase: 'error'; message: string }

/** 포맷별 용량 제한 안내 문구 (경고에 쓴다). */
function limitLabel(format: ExportFormat): string {
  return format === 'gif' ? 'GitHub 10MB(이미지) 제한' : 'GitHub 100MB 제한'
}

/** 익스포트 액션(MP4/GIF 선택) + 완료 후 Finder 열기·경로 복사·용량 경고 (AC1·2·3·4). */
export function ExportPanel({
  status,
  onExport
}: {
  status: ExportStatus
  onExport: (format: ExportFormat) => void
}): JSX.Element {
  if (status.phase === 'encoding') {
    const pct =
      status.totalFrames > 0 ? Math.round((status.renderedFrames / status.totalFrames) * 100) : 0
    return (
      <div className="export-progress">
        <div className="export-progress-head">
          <span>{status.format.toUpperCase()} 익스포트 중…</span>
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
          <span>{status.format.toUpperCase()} 저장 완료</span>
          <span className="export-done-size">{formatMB(status.sizeBytes)}</span>
        </div>
        {status.exceedsLimit && (
          <p className="export-warn">⚠ {limitLabel(status.format)}을 초과했습니다</p>
        )}
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
        <button className="btn btn-export" onClick={() => onExport('mp4')}>
          MP4
        </button>
        <button className="btn btn-export" onClick={() => onExport('gif')}>
          GIF
        </button>
      </div>
    </div>
  )
}
