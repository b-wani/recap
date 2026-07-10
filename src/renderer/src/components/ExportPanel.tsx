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
          {/* 마스코트는 크롬에 없고 익스포트 완료 표면에만 1회 등장한다(디자인 언어 규칙). */}
          <ExportMascot />
          <span>{status.format.toUpperCase()} 저장 완료</span>
          <span className="export-done-size">{formatMB(status.sizeBytes)}</span>
        </div>
        {status.exceedsLimit && (
          <p className="export-warn">⚠ {limitLabel(status.format)}을 초과했습니다</p>
        )}
        <div className="export-actions">
          <button className="btn btn-sm" onClick={() => window.hoppy.revealExport(status.path)}>
            Finder에서 열기
          </button>
          <button className="btn btn-sm" onClick={() => window.hoppy.copyExportPath(status.path)}>
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

/**
 * 익스포트 완료 전용 마스코트 — 에디터 크롬(툴바·패널·타임라인)에는 절대 넣지 않고
 * 완료 표면에만 1회 등장한다(디자인 언어 규칙). 최종 에셋은 #55 로고 확정 후 대체.
 */
function ExportMascot(): JSX.Element {
  return (
    <svg className="export-mascot" viewBox="0 0 120 120" aria-hidden>
      <path
        d="M60 30c26 0 40 20 40 44 0 20-16 30-40 30S20 94 20 74c0-24 14-44 40-44z"
        fill="#4cc93f"
      />
      <circle cx="42" cy="34" r="15" fill="#4cc93f" />
      <circle cx="78" cy="34" r="15" fill="#4cc93f" />
      <circle cx="42" cy="34" r="10" fill="#f2f6ee" />
      <circle cx="78" cy="34" r="10" fill="#f2f6ee" />
      <circle cx="45" cy="36" r="5" fill="#0a1f0c" />
      <circle cx="75" cy="36" r="5" fill="#0a1f0c" />
      <circle cx="47" cy="34" r="1.6" fill="#fff" />
      <circle cx="77" cy="34" r="1.6" fill="#fff" />
      <path d="M46 74q14 12 28 0" stroke="#0a1f0c" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  )
}
