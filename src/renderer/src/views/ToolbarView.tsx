import { useEffect, useState } from 'react'
import type { CaptureMode } from '../../../shared/ipc'

/** 3모드 세그먼트 정의. 세 모드 모두 자식 선택 오버레이에서 확정한다(#71/#73/#72). */
const MODES: { mode: CaptureMode; label: string; icon: string }[] = [
  { mode: 'display', label: 'Display', icon: '◱' },
  { mode: 'window', label: 'Window', icon: '▤' },
  { mode: 'area', label: 'Area', icon: '⬚' }
]

/**
 * 캡처 툴바 — arming 상태의 얼굴(#70). 플로팅 pill 창 안에 3모드 세그먼트 + 설정 팝오버 +
 * 취소를 그린다. 확정은 모드별 자식 선택 오버레이의 몫이다(#57 §1) — Display 는 화면마다
 * 뜨는 오버레이의 Start/클릭(#71), Window 는 창 클릭(#73), Area 는 영역 드래그(#72)로
 * 확정한다(툴바에 별도 Start 버튼 없음). 마스코트는 넣지 않는다(기능 크롬).
 */
export function ToolbarView(): JSX.Element {
  const [mode, setMode] = useState<CaptureMode>('display')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [countdownOn, setCountdownOn] = useState(true)

  // 모드 전환을 main 에 알린다 — 모드별 선택 오버레이(자식 창)를 띄우고, 다른 종류는 닫는다.
  useEffect(() => {
    void window.hoppy.captureSetMode(mode)
  }, [mode])

  // 카운트다운 토글을 main 에도 반영한다 — Display 오버레이는 다른 창(프로세스)이라 이 로컬
  // state 를 직접 공유할 수 없어, 오버레이 생성 시점의 값을 컨텍스트로 스냅샷해 실어 보낸다.
  useEffect(() => {
    void window.hoppy.captureSetCountdown(countdownOn)
  }, [countdownOn])

  // Esc = 취소(어느 컨트롤에 포커스가 있든).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      void window.hoppy.captureCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

        {mode === 'display' ? (
          <span className="toolbar-hint">녹화할 화면에서 Start recording 을 누르세요</span>
        ) : mode === 'window' ? (
          <span className="toolbar-hint">창을 클릭해 선택하세요</span>
        ) : (
          <span className="toolbar-hint">드래그로 영역을 그려 선택하세요</span>
        )}

        <button
          type="button"
          className="icon-btn"
          aria-label="취소"
          onClick={() => void window.hoppy.captureCancel()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
