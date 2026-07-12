import { join } from 'node:path'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

/**
 * 리스타일(#104) 후 UI/UX 회귀 테스트(#105). 스모크(부팅)는 smoke.spec.ts가 담당하고,
 * 여기서는 주요 플로우를 실제 Electron 기동으로 확인한다:
 *
 *  1. 에디터 열기 — 픽스처 녹화 폴더(매니페스트+이벤트+mp4)를 `editor:open` IPC로 열어
 *     에디터 창이 뜨고, 비디오 메타데이터 → 레시피 유도 → 사이드바/타임라인까지 그려지는지.
 *  2. 설정 패널 조작 — 사이드바의 패딩 슬라이더·드롭 섀도 체크박스·맥락 입력을 조작하고,
 *     편집 상태가 recipe.json으로 영속되는지.
 *  3. 익스포트 버튼 상태 — 상단 바 primary 버튼이 활성이고, 클릭 시 팝오버(MP4/GIF)가
 *     열리고 바깥 클릭으로 닫히는지.
 *
 * 에디터는 실제 녹화 없이 열어야 하므로, 임시 폴더에 최소 녹화 픽스처를 만들어
 * `window.recap.openEditor(folder)`(Welcome 창의 preload API)로 연다. 스크린샷은
 * test-results/regression/ 에 남긴다.
 */

const SCREENSHOT_DIR = join(__dirname, '..', 'test-results', 'regression')

/** 임시 녹화 폴더 픽스처 — storage.ts의 매니페스트/이벤트 계약(version 1)을 그대로 따른다. */
function makeRecordingFixture(): string {
  const folder = mkdtempSync(join(tmpdir(), 'recap-e2e-rec-'))
  const videoPath = join(folder, 'recording.mp4')
  copyFileSync(join(__dirname, 'fixtures', 'recording.mp4'), videoPath)

  // 4초 픽스처 영상에 맞춘 이벤트 트랙 — 클릭 2회로 자동 줌 유도가 가능한 최소 구성.
  const eventTrack = {
    protocolVersion: 1,
    startedAt: 1751710200000,
    durationMs: 4000,
    samples: [
      { t: 300, kind: 'move', x: 100, y: 100, cursor: 'arrow' },
      { t: 1000, kind: 'down', x: 320, y: 200, cursor: 'pointer' },
      { t: 1050, kind: 'up', x: 320, y: 200, cursor: 'pointer' },
      { t: 2000, kind: 'move', x: 400, y: 250, cursor: 'arrow' },
      { t: 2500, kind: 'down', x: 420, y: 260, cursor: 'pointer' },
      { t: 2550, kind: 'up', x: 420, y: 260, cursor: 'pointer' },
      { t: 3500, kind: 'move', x: 500, y: 300, cursor: 'arrow' }
    ]
  }
  writeFileSync(join(folder, 'events.json'), JSON.stringify(eventTrack, null, 2), 'utf8')

  const manifest = {
    version: 1,
    videoPath,
    startedAt: eventTrack.startedAt,
    durationMs: eventTrack.durationMs,
    eventCount: eventTrack.samples.length,
    target: {
      kind: 'display',
      id: 'display:1',
      title: 'E2E 픽스처 디스플레이',
      width: 640,
      height: 400
    }
  }
  writeFileSync(join(folder, 'recording.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return folder
}

let app: ElectronApplication
let welcome: Page
let editor: Page
let recordingFolder: string

test.describe.serial('리스타일 후 회귀 (#105)', () => {
  test.beforeAll(async () => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    recordingFolder = makeRecordingFixture()
    const freshUserData = mkdtempSync(join(tmpdir(), 'recap-e2e-'))
    app = await electron.launch({
      args: [join(__dirname, '..', 'out', 'main', 'index.js')],
      env: { ...process.env, RECAP_USER_DATA_DIR: freshUserData }
    })
    // 첫 실행 상태라 온보딩 Welcome 창이 유일한 부팅 창이다(#80).
    welcome = await app.firstWindow()
  })

  test.afterAll(async () => {
    // 메뉴바 상주 앱이라 창을 닫아도 프로세스가 남는다 — main에 직접 exit.
    await app.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.exit(0), 0)
    })
    await app.close().catch(() => {})
  })

  test('Welcome 창이 리스타일 후에도 정상 렌더된다', async () => {
    await expect(welcome.locator('#root')).not.toBeEmpty()
    expect(await welcome.title()).toContain('Recap')
    await welcome.screenshot({ path: join(SCREENSHOT_DIR, '01-welcome.png') })
  })

  test('에디터 열기 — 저장된 녹화를 editor:open으로 열면 편집 UI가 전부 그려진다', async () => {
    const editorWindow = app.waitForEvent('window')
    await welcome.evaluate(
      (folder) => (window as unknown as { recap: { openEditor(f: string): Promise<void> } }).recap.openEditor(folder),
      recordingFolder
    )
    editor = await editorWindow

    // 'Recap 편집기'는 BrowserWindow 타이틀이라(문서 타이틀은 'Recap') main 쪽에서 확인한다.
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((w) => w.getTitle())
          ),
        { timeout: 15_000 }
      )
      .toContain('Recap 편집기')

    // 상단 바 — 녹화 정체성(대상·길이)과 익스포트 primary 버튼.
    await expect(editor.locator('.editor-bar')).toContainText('전체 화면')
    await expect(editor.locator('.editor-bar')).toContainText('E2E 픽스처 디스플레이')

    // 비디오 메타데이터 로드 → 레시피 유도 후에야 사이드바/타임라인이 붙는다.
    await expect(editor.locator('.editor-sidebar')).toBeVisible({ timeout: 15_000 })
    for (const section of ['배경', '커서', '배지 · 키 입력', '스타일 프리셋']) {
      await expect(editor.locator('.side-section-title', { hasText: section })).toBeVisible()
    }
    await expect(editor.locator('.editor-timeline')).toBeVisible()
    await editor.screenshot({ path: join(SCREENSHOT_DIR, '02-editor.png') })
  })

  test('설정 패널 조작 — 패딩·드롭 섀도·맥락 입력이 반영되고 recipe.json으로 영속된다', async () => {
    // 패딩 슬라이더: React가 추적하는 value를 네이티브 setter로 바꿔 input 이벤트를 쏜다.
    const padding = editor.locator('.side-section', { hasText: '배경' }).locator('input[type="range"]').first()
    await padding.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, '0.2')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(
      editor.locator('.control', { hasText: '패딩' }).locator('.control-value')
    ).toHaveText('20%')

    // 드롭 섀도 체크박스 토글.
    const shadow = editor.locator('.control-check', { hasText: '드롭 섀도' }).locator('input[type="checkbox"]')
    const wasChecked = await shadow.isChecked()
    await shadow.click()
    await expect(shadow).toBeChecked({ checked: !wasChecked })

    // 맥락(브랜치/커밋) 텍스트 입력.
    const contextInput = editor.getByPlaceholder('예: feat/v2-overlay @ 61e6fd6')
    await contextInput.fill('e2e/105 @ regression')
    await expect(contextInput).toHaveValue('e2e/105 @ regression')

    // 편집 상태는 변경 즉시 녹화 폴더 recipe.json으로 저장된다(#9 영속화).
    await expect
      .poll(
        () => {
          try {
            return readFileSync(join(recordingFolder, 'recipe.json'), 'utf8')
          } catch {
            return ''
          }
        },
        { timeout: 10_000 }
      )
      .toContain('e2e/105 @ regression')
    await editor.screenshot({ path: join(SCREENSHOT_DIR, '03-settings-panel.png') })
  })

  test('익스포트 버튼 상태 — 활성 primary 버튼, 팝오버 열림/닫힘, MP4·GIF 액션 노출', async () => {
    const exportButton = editor.locator('.btn-export-primary')
    await expect(exportButton).toBeVisible()
    await expect(exportButton).toBeEnabled()
    await expect(exportButton).toHaveAttribute('aria-expanded', 'false')

    await exportButton.click()
    await expect(exportButton).toHaveAttribute('aria-expanded', 'true')
    const popover = editor.locator('.export-popover')
    await expect(popover).toBeVisible()
    await expect(popover.locator('.btn-export', { hasText: 'MP4' })).toBeEnabled()
    await expect(popover.locator('.btn-export', { hasText: 'GIF' })).toBeEnabled()
    await editor.screenshot({ path: join(SCREENSHOT_DIR, '04-export-popover.png') })

    // 팝오버 밖(캔버스 영역) 클릭으로 닫힌다.
    await editor.locator('.canvas-wrap').click()
    await expect(popover).not.toBeVisible()
    await expect(exportButton).toHaveAttribute('aria-expanded', 'false')
  })
})
