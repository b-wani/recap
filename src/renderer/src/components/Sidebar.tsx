import {
  CURSOR_DEFAULTS,
  ZOOM_DEFAULTS,
  type RenderRecipe
} from '../../../shared/recipe'
import { setZoomSegmentScale } from '../../../shared/recipe.edit'
import { type ExportFormat } from '../../../shared/export-preset'
import { ExportPanel, type ExportStatus } from './ExportPanel'

/**
 * 우측 설정 사이드바 — 단일 스크롤 패널. 선택 상태에 따라 두 모드로 그린다:
 *
 * - 기본 패널: 배경/패딩 · 커서 · 배지/키 오버레이 · 익스포트 섹션 (탭 없이 한 컬럼).
 * - 컨텍스트 패널: 타임라인에서 줌 구간을 선택하면 그 구간의 배율·삭제만 보여준다.
 *
 * 편집은 전부 update(레시피 변환)로 올리고, 줌 삭제는 상위가 선택 해제까지 처리하도록
 * onDeleteSegment로 위임한다(선택 상태는 상위의 useState 하나가 소유한다).
 */
export function Sidebar({
  recipe,
  update,
  selected,
  onDeleteSegment,
  exportStatus,
  onExport,
  eventCount,
  folder
}: {
  recipe: RenderRecipe
  update: (fn: (r: RenderRecipe) => RenderRecipe) => void
  selected: number | null
  onDeleteSegment: (index: number) => void
  exportStatus: ExportStatus
  onExport: (format: ExportFormat) => void
  eventCount: number
  folder: string
}): JSX.Element {
  const segment = selected !== null ? recipe.zoomSegments[selected] : undefined

  // 컨텍스트 패널 — 줌 구간 편집 (배율 · 삭제).
  if (selected !== null && segment) {
    return (
      <aside className="editor-sidebar">
        <fieldset className="side-section">
          <legend className="side-section-title">줌 구간 #{selected + 1}</legend>
          <p className="side-hint">배율</p>
          <div className="scale-buttons">
            {ZOOM_DEFAULTS.scales.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-scale${segment.scale === s ? ' is-active' : ''}`}
                onClick={() => update((r) => setZoomSegmentScale(r, selected, s))}
              >
                {s.toFixed(1)}x
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onDeleteSegment(selected)}
          >
            줌 구간 삭제
          </button>
          <p className="side-hint">빈 곳을 클릭하거나 Esc를 누르면 기본 설정으로 돌아갑니다.</p>
        </fieldset>
      </aside>
    )
  }

  // 기본 패널.
  return (
    <aside className="editor-sidebar">
      {/* ① 배경 / 패딩 */}
      <fieldset className="side-section">
        <legend className="side-section-title">배경</legend>
        <label className="control control-row">
          <span>배경색</span>
          <input
            type="color"
            value={recipe.background.color}
            onChange={(e) =>
              update((r) => ({ ...r, background: { ...r.background, color: e.target.value } }))
            }
          />
        </label>
        <label className="control">
          <span className="control-row">
            <span>패딩</span>
            <span className="control-value">{Math.round(recipe.background.padding * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={0.4}
            step={0.01}
            value={recipe.background.padding}
            onChange={(e) =>
              update((r) => ({
                ...r,
                background: { ...r.background, padding: Number(e.target.value) }
              }))
            }
          />
        </label>
      </fieldset>

      {/* ② 커서 */}
      <fieldset className="side-section">
        <legend className="side-section-title">커서</legend>
        <div className="control">
          <span>크기</span>
          <div className="scale-buttons">
            {CURSOR_DEFAULTS.sizes.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-scale${recipe.cursor.size === s ? ' is-active' : ''}`}
                onClick={() => update((r) => ({ ...r, cursor: { ...r.cursor, size: s } }))}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div className="control">
          <span>스무딩</span>
          <div className="scale-buttons">
            {CURSOR_DEFAULTS.smoothingLevels.map((lv) => (
              <button
                key={lv.label}
                type="button"
                className={`btn btn-scale is-text${recipe.cursor.smoothingMs === lv.value ? ' is-active' : ''}`}
                onClick={() =>
                  update((r) => ({ ...r, cursor: { ...r.cursor, smoothingMs: lv.value } }))
                }
              >
                {lv.label}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      {/* ③ 배지 · 키 입력 오버레이 */}
      <fieldset className="side-section">
        <legend className="side-section-title">배지 · 키 입력</legend>
        <label className="control control-check">
          <input
            type="checkbox"
            checked={recipe.badge.visible}
            onChange={(e) => update((r) => ({ ...r, badge: { ...r.badge, visible: e.target.checked } }))}
          />
          <span>뷰포트 크기 배지</span>
        </label>
        <label className="control">
          <span>맥락 (브랜치/커밋)</span>
          <input
            type="text"
            className="control-text"
            placeholder="예: feat/v2-overlay @ 61e6fd6"
            value={recipe.badge.contextLabel}
            onChange={(e) =>
              update((r) => ({ ...r, badge: { ...r.badge, contextLabel: e.target.value } }))
            }
          />
        </label>
        <label className="control control-check">
          <input
            type="checkbox"
            checked={recipe.keystrokes.overlayVisible}
            onChange={(e) =>
              update((r) => ({
                ...r,
                keystrokes: { ...r.keystrokes, overlayVisible: e.target.checked }
              }))
            }
          />
          <span>키 입력 오버레이</span>
        </label>
      </fieldset>

      {/* ④ 익스포트 */}
      <fieldset className="side-section">
        <legend className="side-section-title">익스포트</legend>
        <ExportPanel status={exportStatus} onExport={onExport} />
      </fieldset>

      {/* 메타 정보 */}
      <dl className="meta">
        <div>
          <dt>자동 줌</dt>
          <dd>{recipe.zoomSegments.length}개 구간 (클릭에서 자동 생성)</dd>
        </div>
        <div>
          <dt>이벤트 트랙</dt>
          <dd>{eventCount}개 이벤트 (events.json 분리 저장)</dd>
        </div>
        <div>
          <dt>폴더</dt>
          <dd className="path">{folder}</dd>
        </div>
      </dl>
    </aside>
  )
}
