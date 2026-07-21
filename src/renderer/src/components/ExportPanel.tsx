import { formatMB, formatElapsed } from '../format'
import {
  heightsForFormat,
  sizeLabel,
  fpsLabelsForFormat,
  QUALITY_TIERS,
  TIER_LABELS,
  tierDescription,
  type ExportFormat,
  type ExportSelection,
  type QualityTier
} from '../../../shared/export-preset'

/** 익스포트 진행 상태. 패널·전체화면 진행 화면을 이 상태만 보고 그린다. */
export type ExportStatus =
  | { phase: 'idle' }
  | { phase: 'encoding'; renderedFrames: number; totalFrames: number; startedAt: number }
  | { phase: 'done'; path: string; sizeBytes: number; exceedsLimit: boolean; copied: boolean }
  | { phase: 'error'; message: string }

/** 익스포트 사전 추정치 — 패널 하단 "예상 시간·최대 용량" 표기(#159 AC7). */
export interface ExportEstimate {
  sizeBytes: number
  seconds: number
  /** GIF가 Dooray 인라인 임계(25MB)를 넘는지(#118). GIF일 때만 의미 있음. */
  exceedsLimit: boolean
}

/** 익스포트 실행 의도 — 파일로 저장 vs 클립보드로 복사(SS 이중 액션). */
export type ExportIntent = 'file' | 'clipboard'

/** 세그먼트 토글 한 줄 — 활성 항목만 primary로 채운다. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  isDisabled
}: {
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (v: T) => void
  isDisabled?: (v: T) => boolean
}): JSX.Element {
  return (
    <div className="seg" role="group">
      {options.map((o) => {
        const disabled = o.disabled ?? isDisabled?.(o.value) ?? false
        return (
          <button
            key={String(o.value)}
            type="button"
            className={`seg-btn${o.value === value ? ' is-active' : ''}`}
            aria-pressed={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 포맷-우선 익스포트 패널(#159) — Screen Studio 실측 모작. 포맷 토글(MP4/GIF) + Output Size +
 * Frame rate + Quality 4티어. 포맷별로 해상도·프레임레이트 옵션을 게이팅하고(GIF 상한 1080p/50fps),
 * 하단에 예상 시간·최대 용량과 Dooray 25MB 경고를 표시한다. 진행 화면은 전체화면 오버레이가 담당한다.
 */
export function ExportPanel({
  status,
  format,
  onFormatChange,
  selection,
  onSelectionChange,
  sourceHeight,
  estimate,
  onExport,
  onClose
}: {
  status: ExportStatus
  format: ExportFormat
  onFormatChange: (next: ExportFormat) => void
  selection: ExportSelection
  onSelectionChange: (next: ExportSelection) => void
  /** 원본 세로(px) — 초과 해상도 옵션을 비활성하는 상한. */
  sourceHeight: number
  estimate: ExportEstimate
  onExport: (intent: ExportIntent) => void
  onClose: () => void
}): JSX.Element {
  const formatLabel = format.toUpperCase()

  if (status.phase === 'encoding') {
    // 인코딩 중에는 전체화면 진행 오버레이가 화면을 덮으므로 팝오버는 최소 안내만 둔다.
    return <div className="export-done">{formatLabel} 익스포트 중…</div>
  }

  if (status.phase === 'done') {
    return (
      <div className="export-done">
        <div className="export-done-head">
          <span>{status.copied ? '클립보드에 복사됨' : `${formatLabel} 저장 완료`}</span>
          <span className="export-done-size">{formatMB(status.sizeBytes)}</span>
        </div>
        {status.exceedsLimit && (
          <p className="export-warn">
            ⚠ Dooray 본문에 인라인으로 넣기엔 큰 용량 — 해상도/품질을 낮춰 다시 내보내기
          </p>
        )}
        <div className="export-actions">
          <button className="btn btn-sm" onClick={() => window.recap.revealExport(status.path)}>
            Finder에서 열기
          </button>
          <button className="btn btn-sm" onClick={() => window.recap.copyExportMedia(status.path)}>
            클립보드로 복사
          </button>
        </div>
      </div>
    )
  }

  const heights = heightsForFormat(format)
  const fpsLabels = fpsLabelsForFormat(format)
  // 원본 초과 해상도는 비활성하되, 원본이 최소 옵션보다도 작으면 최소 옵션은 살려 둔다(선택 불가 방지).
  const minHeight = Math.min(...heights)
  const heightDisabled = (h: number): boolean => h > sourceHeight && h !== minHeight

  return (
    <div className="export-panel">
      {status.phase === 'error' && <p className="export-warn">익스포트 실패: {status.message}</p>}

      <div className="export-grid">
        <div className="export-field">
          <span className="export-field-label">Export as</span>
          <Segmented<ExportFormat>
            options={[
              { value: 'mp4', label: 'MP4' },
              { value: 'gif', label: 'GIF' }
            ]}
            value={format}
            onChange={onFormatChange}
          />
        </div>
        <div className="export-field">
          <span className="export-field-label">Frame rate</span>
          <Segmented<string>
            options={fpsLabels.map((l) => ({ value: l, label: l.replace('fps', '') }))}
            value={selection.fps}
            onChange={(fps) => onSelectionChange({ ...selection, fps })}
          />
        </div>
      </div>

      <div className="export-field">
        <span className="export-field-label">Output Size</span>
        <Segmented<number>
          options={heights.map((h) => ({
            value: h,
            label: sizeLabel(h),
            disabled: heightDisabled(h)
          }))}
          value={selection.height}
          onChange={(height) => onSelectionChange({ ...selection, height })}
        />
      </div>

      <div className="export-field">
        <span className="export-field-label">Quality (Compression level)</span>
        <Segmented<QualityTier>
          options={QUALITY_TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
          value={selection.tier}
          onChange={(tier) => onSelectionChange({ ...selection, tier })}
        />
        <p className="export-tier-desc">{tierDescription(format, selection.tier)}</p>
      </div>

      <div className="export-estimate">
        <span>예상 시간 — {estimate.seconds}초</span>
        <span>예상 최대 용량 — {formatMB(estimate.sizeBytes)}</span>
        {format === 'gif' && estimate.exceedsLimit && (
          <span className="export-warn">⚠ Dooray 인라인 임계(25MB) 초과 예상</span>
        )}
      </div>

      <div className="export-actions">
        <button className="btn btn-export" onClick={() => onExport('file')}>
          파일로 내보내기
        </button>
        <button className="btn btn-sm" onClick={() => onExport('clipboard')}>
          클립보드로 복사
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  )
}

/**
 * 전체화면 익스포트 진행 화면(#159) — Screen Studio 진행 UI 모작. 소스→목적 경로 알약,
 * "Exporting… N%", 경과·잔여 시간, Stop export. 인코딩 중 에디터 위를 덮는 오버레이다.
 */
export function ExportProgressOverlay({
  format,
  renderedFrames,
  totalFrames,
  startedAt,
  sourceLabel,
  destLabel,
  onStop
}: {
  format: ExportFormat
  renderedFrames: number
  totalFrames: number
  startedAt: number
  sourceLabel: string
  destLabel: string
  onStop: () => void
}): JSX.Element {
  const frac = totalFrames > 0 ? renderedFrames / totalFrames : 0
  const pct = Math.round(frac * 100)
  const elapsedMs = Math.max(0, Date.now() - startedAt)
  // 남은 시간은 지금까지의 진행 속도로 선형 외삽한다(0 진행이면 미표기).
  const remainingMs = frac > 0.01 ? (elapsedMs / frac) * (1 - frac) : 0

  return (
    <div className="export-overlay">
      <div className="export-overlay-inner">
        <div className="export-pill">
          {sourceLabel} <span aria-hidden>→</span> {destLabel}
        </div>
        <div className="export-overlay-title">
          {format.toUpperCase()} 익스포트 중 · {pct}%
        </div>
        <div className="progress-bar export-overlay-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="export-overlay-time">
          {formatElapsed(elapsedMs)}
          {remainingMs > 0 && ` · ${formatElapsed(remainingMs)} 남음`}
        </div>
        <button className="btn btn-sm export-overlay-stop" onClick={onStop}>
          Stop export
        </button>
      </div>
    </div>
  )
}
