import { Tray, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { RecordingState, RecordingSummary } from '../shared/ipc'

/**
 * 메뉴바 상주 아이콘. 앱의 유일한 앵커(#54) — idle 에서는 캡처 툴바를 소환하고, 녹화
 * 중에는 빨간 점 + 경과 시간을 표시하며 클릭으로 정지할 수 있다. 창을 모두 닫아도
 * 앱은 여기 남아 있으며, 종료는 컨텍스트 메뉴의 '종료'로만 한다.
 *
 * 좌클릭 = 상태별 기본 동작(녹화 중이면 정지, 아니면 캡처 툴바 소환),
 * 우클릭 = 컨텍스트 메뉴(녹화 시작/정지 · Welcome · 라이브러리 · 최근 녹화 · 종료).
 */
export interface TrayCallbacks {
  /** ⌥⌘R 과 동일 — 녹화 중이면 정지, 아니면 캡처 툴바 소환. */
  onToggleRecord: () => void
  /** Welcome(온보딩) 창을 다시 연다 — 완료 플래그와 무관하게 항상 허용(#80). */
  onShowWelcome: () => void
  /** 라이브러리 창을 열거나 포커스한다(#78) — 전체 브라우즈의 정식 진입점. */
  onShowLibrary: () => void
  /** 저장된 녹화를 다시 연다. */
  onOpenRecording: (folder: string) => void
  /** 최근 녹화 목록을 최신순으로 가져온다(컨텍스트 메뉴용). */
  listRecentRecordings: () => Promise<RecordingSummary[]>
  /** 앱을 완전히 종료한다. */
  onQuit: () => void
}

/** 경과 시간을 메뉴바 타이틀용 `m:ss` 로 포맷한다. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export class AppTray {
  private readonly tray: Tray
  private readonly idleIcon: Electron.NativeImage
  private readonly recordingIcon: Electron.NativeImage
  private state: RecordingState = { status: 'idle' }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    idleIconPath: string,
    recordingIconPath: string,
    private readonly cb: TrayCallbacks
  ) {
    this.idleIcon = nativeImage.createFromPath(idleIconPath)
    // 템플릿 이미지: macOS 가 알파를 읽어 다크/라이트 메뉴바에 맞춰 재색칠한다.
    this.idleIcon.setTemplateImage(true)
    // 녹화 중 아이콘은 빨간색을 유지해야 하므로 템플릿이 아니다.
    this.recordingIcon = nativeImage.createFromPath(recordingIconPath)

    this.tray = new Tray(this.idleIcon)
    this.tray.setToolTip('Recap')

    // 좌클릭: 녹화 중이면 정지, 아니면 캡처 툴바 소환(#70). onToggleRecord 가 둘을 판단한다.
    this.tray.on('click', () => this.cb.onToggleRecord())
    this.tray.on('right-click', () => void this.showMenu())
  }

  /** 상태 변화를 반영한다 — 아이콘/타이틀 교체 및 경과 시간 타이머 관리. */
  update(state: RecordingState): void {
    const wasRecording = this.state.status === 'recording'
    this.state = state
    if (state.status === 'recording') {
      this.tray.setImage(this.recordingIcon)
      if (!wasRecording) this.startTimer(state.startedAt)
    } else {
      this.stopTimer()
      this.tray.setImage(this.idleIcon)
      this.tray.setTitle('')
    }
  }

  destroy(): void {
    this.stopTimer()
    this.tray.destroy()
  }

  private startTimer(startedAt: number): void {
    const render = (): void => this.tray.setTitle(` ${formatClock(Date.now() - startedAt)}`)
    render()
    this.timer = setInterval(render, 1000)
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async showMenu(): Promise<void> {
    const menu = await this.buildMenu()
    this.tray.popUpContextMenu(menu)
  }

  private async buildMenu(): Promise<Menu> {
    if (this.state.status === 'recording') {
      return Menu.buildFromTemplate([
        { label: '● 녹화 중 — 정지 (⌥⌘R)', click: () => this.cb.onToggleRecord() },
        { type: 'separator' },
        { label: '종료', click: () => this.cb.onQuit() }
      ])
    }

    const recent = await this.cb.listRecentRecordings().catch(() => [])
    const recentItems: MenuItemConstructorOptions[] =
      recent.length === 0
        ? [{ label: '(없음)', enabled: false }]
        : recent.slice(0, 8).map((r) => ({
            label: r.title,
            click: () => this.cb.onOpenRecording(r.folder)
          }))

    return Menu.buildFromTemplate([
      { label: '녹화 시작 (⌥⌘R)', click: () => this.cb.onToggleRecord() },
      { label: 'Welcome 다시 보기', click: () => this.cb.onShowWelcome() },
      { type: 'separator' },
      { label: '라이브러리 열기', click: () => this.cb.onShowLibrary() },
      { label: '최근 녹화', submenu: recentItems },
      { type: 'separator' },
      { label: '종료', click: () => this.cb.onQuit() }
    ])
  }
}
