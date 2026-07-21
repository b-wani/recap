import { useState } from 'react'
import {
  CURSOR_DEFAULTS,
  GRADIENT_PRESETS,
  SHADOW_ON,
  ZOOM_DEFAULTS,
  type RenderRecipe
} from '../../../shared/recipe'
import { setZoomSegmentScale } from '../../../shared/recipe.edit'
import type { StylePreset } from '../../../shared/style-preset'
import type { EditorSection } from './editor-rail'

/**
 * 우측 설정 사이드바 — 세로 레일(#162)이 고른 섹션 하나만 그린다:
 *
 * - select: 배경/패딩/라운딩/섀도 + 스타일 프리셋 + 메타
 * - cursor: 커서 컨트롤
 * - camera: 줌 구간 편집(타임라인에서 구간 선택 시 배율·삭제, 없으면 안내)
 * - caption: 뷰포트 배지 · 맥락 라벨
 * - shortcuts: 키 입력 오버레이
 *
 * 익스포트는 상단 바 primary 버튼(팝오버)로 옮겨졌다(#76, D3) — 여기서는 다루지 않는다.
 *
 * 편집은 전부 update(레시피 변환)로 올리고, 줌 삭제는 상위가 선택 해제까지 처리하도록
 * onDeleteSegment로 위임한다(선택 상태는 상위의 useState 하나가 소유한다).
 */
export function Sidebar({
  recipe,
  update,
  section,
  selected,
  onDeleteSegment,
  eventCount,
  folder,
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset
}: {
  recipe: RenderRecipe
  update: (fn: (r: RenderRecipe) => RenderRecipe) => void
  /** 레일이 고른 활성 섹션(#162). */
  section: EditorSection
  selected: number | null
  onDeleteSegment: (index: number) => void
  eventCount: number
  folder: string
  /** 앱 전역 스타일 프리셋 목록(배경/커서 스타일 번들, #77). 줌·트림 등은 담지 않는다. */
  presets: StylePreset[]
  onSavePreset: (name: string) => void
  onApplyPreset: (preset: StylePreset) => void
  onDeletePreset: (id: string) => void
}): JSX.Element {
  const [presetName, setPresetName] = useState('')
  const segment = selected !== null ? recipe.zoomSegments[selected] : undefined

  // 카메라(줌) — 타임라인에서 고른 줌 구간의 배율·삭제. 선택 전이면 안내만 보여준다.
  if (section === 'camera') {
    return (
      <aside className="editor-sidebar">
        {selected !== null && segment ? (
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
            <p className="side-hint">빈 곳을 클릭하거나 Esc를 누르면 선택이 해제됩니다.</p>
          </fieldset>
        ) : (
          <fieldset className="side-section">
            <legend className="side-section-title">카메라 · 줌</legend>
            <p className="side-hint">타임라인에서 줌 구간을 선택하면 배율·삭제를 편집할 수 있습니다.</p>
          </fieldset>
        )}
      </aside>
    )
  }

  // 커서.
  if (section === 'cursor') {
    return (
      <aside className="editor-sidebar">
        <fieldset className="side-section">
          <legend className="side-section-title">커서</legend>
          <label className="control control-check">
            <input
              type="checkbox"
              checked={recipe.cursor.hidden}
              onChange={(e) => update((r) => ({ ...r, cursor: { ...r.cursor, hidden: e.target.checked } }))}
            />
            <span>커서 숨김</span>
          </label>
          <label className="control">
            <span className="control-row">
              <span>크기</span>
              <span className="control-value">{recipe.cursor.size.toFixed(1)}x</span>
            </span>
            <div className="control-row">
              <input
                type="range"
                min={CURSOR_DEFAULTS.sizeMin}
                max={CURSOR_DEFAULTS.sizeMax}
                step={CURSOR_DEFAULTS.sizeStep}
                value={recipe.cursor.size}
                disabled={recipe.cursor.hidden}
                onChange={(e) =>
                  update((r) => ({ ...r, cursor: { ...r.cursor, size: Number(e.target.value) } }))
                }
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  update((r) => ({ ...r, cursor: { ...r.cursor, size: CURSOR_DEFAULTS.size } }))
                }
              >
                Reset
              </button>
            </div>
          </label>
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
          <label className="control control-check">
            <input
              type="checkbox"
              checked={recipe.cursor.hideWhenIdle}
              onChange={(e) =>
                update((r) => ({ ...r, cursor: { ...r.cursor, hideWhenIdle: e.target.checked } }))
              }
            />
            <span>유휴 시 자동 숨김</span>
          </label>
          <label className="control control-check">
            <input
              type="checkbox"
              checked={recipe.cursor.loopReturn}
              onChange={(e) =>
                update((r) => ({ ...r, cursor: { ...r.cursor, loopReturn: e.target.checked } }))
              }
            />
            <span>루프 초기위치 복귀</span>
          </label>
        </fieldset>
      </aside>
    )
  }

  // 캡션 · 배지 — 뷰포트 크기 배지 + 맥락 라벨.
  if (section === 'caption') {
    return (
      <aside className="editor-sidebar">
        <fieldset className="side-section">
          <legend className="side-section-title">캡션 · 배지</legend>
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
        </fieldset>
      </aside>
    )
  }

  // 단축키 오버레이 — 키 입력 오버레이.
  if (section === 'shortcuts') {
    return (
      <aside className="editor-sidebar">
        <fieldset className="side-section">
          <legend className="side-section-title">단축키 오버레이</legend>
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
      </aside>
    )
  }

  // select — 배경/패딩/스타일 프리셋 + 메타.
  return (
    <aside className="editor-sidebar">
      {/* ① 배경 / 패딩 / 라운딩 / 섀도 */}
      <fieldset className="side-section">
        <legend className="side-section-title">배경</legend>
        <div className="control">
          <span>스타일</span>
          <div className="bg-swatches">
            {GRADIENT_PRESETS.map((p) => {
              const active =
                recipe.background.type === 'gradient' &&
                recipe.background.gradient.stops[0] === p.gradient.stops[0] &&
                recipe.background.gradient.stops[1] === p.gradient.stops[1]
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  className={`bg-swatch${active ? ' is-active' : ''}`}
                  style={{
                    background: `linear-gradient(160deg, ${p.gradient.stops[0]}, ${p.gradient.stops[1]})`
                  }}
                  onClick={() =>
                    update((r) => ({
                      ...r,
                      background: { ...r.background, type: 'gradient', gradient: p.gradient }
                    }))
                  }
                />
              )
            })}
            <label
              className={`bg-swatch bg-swatch-solid${recipe.background.type === 'color' ? ' is-active' : ''}`}
              title="단색"
              style={{ background: recipe.background.color }}
            >
              <input
                type="color"
                value={recipe.background.color}
                onChange={(e) =>
                  update((r) => ({
                    ...r,
                    background: { ...r.background, type: 'color', color: e.target.value }
                  }))
                }
              />
            </label>
          </div>
        </div>
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
        <label className="control">
          <span className="control-row">
            <span>라운딩</span>
            <span className="control-value">{Math.round(recipe.background.cornerRadius)}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={32}
            step={1}
            value={recipe.background.cornerRadius}
            onChange={(e) =>
              update((r) => ({
                ...r,
                background: { ...r.background, cornerRadius: Number(e.target.value) }
              }))
            }
          />
        </label>
        <label className="control control-check">
          <input
            type="checkbox"
            checked={recipe.background.shadow > 0}
            onChange={(e) =>
              update((r) => ({
                ...r,
                background: { ...r.background, shadow: e.target.checked ? SHADOW_ON : 0 }
              }))
            }
          />
          <span>드롭 섀도</span>
        </label>
      </fieldset>

      {/* ② 스타일 프리셋 — 배경/커서 스타일 번들만(줌·트림 등 녹화별 편집은 담지 않는다, #77) */}
      <fieldset className="side-section">
        <legend className="side-section-title">스타일 프리셋</legend>
        <div className="control control-row preset-save">
          <input
            type="text"
            className="control-text"
            placeholder="프리셋 이름"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={presetName.trim().length === 0}
            onClick={() => {
              onSavePreset(presetName.trim())
              setPresetName('')
            }}
          >
            저장
          </button>
        </div>
        {presets.length === 0 ? (
          <p className="side-hint">저장된 프리셋이 없습니다. 현재 스타일을 이름 붙여 저장해보세요.</p>
        ) : (
          <ul className="preset-list">
            {presets.map((p) => (
              <li key={p.id} className="preset-item">
                <span className="preset-name">{p.name}</span>
                <div className="preset-actions">
                  <button type="button" className="btn btn-sm" onClick={() => onApplyPreset(p)}>
                    적용
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => onDeletePreset(p.id)}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
