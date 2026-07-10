import { useEffect, useRef, useState } from 'react'
import type { CaptureMode } from '../../../shared/ipc'

/** 3모드 세그먼트 정의. Display/Window 가 이번 티켓들에서 녹화까지 이어진다(#70/#73). */
const MODES: { mode: CaptureMode; label: string; icon: string }[] = [
  { mode: 'display', label: 'Display', icon: '◱' },
  { mode: 'window', label: 'Window', icon: '▤' },
  { mode: 'area', label: 'Area', icon: '⬚' }
]

/**
 * 캡처 툴바 — arming 상태의 얼굴(#70). 플로팅 pill 창 안에 3모드 세그먼트 + 설정 팝오버 +
 * 시작/취소를 그린다. Display 는 주 디스플레이로 바로 녹화하고, Window 는 자식 선택
 * 오버레이(#73)에서 창을 클릭해, Area 는 자식 선택 오버레이(#72)에서 영역을 그려
 * 확정한다(둘 다 툴바에 별도 Start 버튼 없음). 마스코트는 넣지 않는다(기능 크롬).
 */
export function ToolbarView(): JSX.Element {
  const [mode, setMode] = useState<CaptureMode>('display')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [countdownOn, setCountdownOn] = useState(true)
  const [count, setCount] = useState<number | null>(null)

  const canRecord = mode === 'display' // Window/Area 는 오버레이에서 확정(#73/#72)

  // 모드 전환을 main 에 알린다 — Window/Area 는 해당 선택 오버레이(자식 창)를 띄우고, 그 외는 닫는다.
  useEffect(() => {
    void window.recap.captureSetMode(mode)
  }, [mode])

  // Esc = 취소(어느 컨트롤에 포커스가 있든). 카운트다운 중이면 카운트다운만 중단한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (count !== null) setCount(null)
      else void window.recap.captureCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count])

  // 카운트다운 진행 — 0 에 도달하면 실제 녹화를 시작한다(main 이 툴바를 파괴).
  const startedRef = useRef(false)
  useEffect(() => {
    if (count === null) return
    if (count <= 0) {
      if (!startedRef.current) {
        startedRef.current = true
        void window.recap.captureStart('display')
      }
      return
    }
    const id = setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(id)
  }, [count])

  const onStart = (): void => {
    if (!canRecord) return
    if (countdownOn) setCount(3)
    else void window.recap.captureStart('display')
  }

  if (count !== null) {
    return (
      <div className="toolbar toolbar-countdown" role="status" aria-live="assertive">
        <span className="countdown-num">{count === 0 ? '●' : count}</span>
        <span className="countdown-hint">Esc 로 취소</span>
      </div>
    )
  }

  return (
    <div className="toolbar">
      <div className="toolbar-modes" role="tablist" aria-label="캡처 모드">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="tab"
            aria-selected={mode === m.mode}
            className={`mode-seg${mode === m.mode ? ' is-active' : ''}`}
            onClick={() => setMode(m.mode)}
          >
            <span aria-hidden>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>

      <div className="toolbar-right">
        <div className="toolbar-settings">
          <button
            type="button"
            className={`icon-btn${settingsOpen ? ' is-active' : ''}`}
            aria-label="캡처 설정"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            ⚙
          </button>
          {settingsOpen ? (
            <div className="settings-popover" role="dialog" aria-label="캡처 설정">
              <label className="settings-row">
                <span>3-2-1 카운트다운</span>
                <input
                  type="checkbox"
                  checked={countdownOn}
                  onChange={(e) => setCountdownOn(e.target.checked)}
                />
              </label>
              <div className="settings-row settings-readout">
                <span>해상도·FPS</span>
                <span className="mono">네이티브 2× · 60fps</span>
              </div>
            </div>
          ) : null}
        </div>

        {canRecord ? (
          <button type="button" className="btn btn-record toolbar-start" onClick={onStart}>
            ● 녹화 시작
          </button>
        ) : mode === 'window' ? (
          <span className="toolbar-hint">창을 클릭해 선택하세요</span>
        ) : (
          <span className="toolbar-hint">드래그로 영역을 그려 선택하세요</span>
        )}

        <button
          type="button"
          className="icon-btn"
          aria-label="취소"
          onClick={() => void window.recap.captureCancel()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
