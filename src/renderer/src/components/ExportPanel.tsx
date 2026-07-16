import { formatMB } from '../format'
import {
  GIF_HEIGHTS,
  GIF_FPS_OPTIONS,
  type GifSelection
} from '../../../shared/export-preset'

/** 익스포트 진행 상태. 미리보기 패널의 하단 액션을 이 상태만 보고 그린다. export 출력은 GIF 단일. */
export type ExportStatus =
  | { phase: 'idle' }
  | { phase: 'encoding'; renderedFrames: number; totalFrames: number }
  | { phase: 'done'; path: string; sizeBytes: number; exceedsLimit: boolean }
  | { phase: 'error'; message: string }

/** 용량 경고 문구 — Dooray 본문 인라인 렌더 부담(#118) + 재-export 유도(MP4 폴백 없음). */
const LIMIT_LABEL = 'Dooray 본문에 인라인으로 넣기엔 큰 용량 — 해상도/fps를 낮춰 다시 내보내기'

/** 익스포트 액션(해상도·fps 선택 + GIF 내보내기) + 완료 후 Finder 열기·경로 복사·용량 경고 (AC1·2·3·4). */
export function ExportPanel({
  status,
  selection,
  onSelectionChange,
  sourceHeight,
  onExport
}: {
  status: ExportStatus
  selection: GifSelection
  onSelectionChange: (next: GifSelection) => void
  /** 원본 세로(px) — 초과 해상도 옵션을 비활성하는 상한. */
  sourceHeight: number
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
      <div className="export-controls">
        <label className="export-field">
          <span className="export-field-label">해상도</span>
          <select
            className="export-select"
            value={selection.height}
            onChange={(e) => onSelectionChange({ ...selection, height: Number(e.target.value) })}
          >
            {GIF_HEIGHTS.map((h) => {
              // 원본 상한 — 초과 옵션은 비활성 + 주석("1080p — 원본 720p"). 업스케일 안 함(#122).
              const disabled = h > sourceHeight
              return (
                <option key={h} value={h} disabled={disabled}>
                  {h}p{disabled ? ` — 원본 ${sourceHeight}p` : ''}
                </option>
              )
            })}
          </select>
        </label>
        <label className="export-field">
          <span className="export-field-label">fps</span>
          <select
            className="export-select"
            value={selection.fps}
            onChange={(e) => onSelectionChange({ ...selection, fps: e.target.value })}
          >
            {GIF_FPS_OPTIONS.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn btn-export" onClick={onExport}>
        GIF 내보내기
      </button>
    </div>
  )
}
