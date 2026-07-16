import { join } from 'node:path'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import type { RecapApi } from '../src/preload'

/**
 * UI 결함 인벤토리 하네스(#135, 일회성). 회귀 테스트가 아니라 **증거 수집기**다:
 * 전체 플로우 화면을 실제 Electron 으로 열어 스크린샷을 남기고, 각 화면에서
 * 오버플로우(scrollWidth > clientWidth)·잘림 후보를 DOM 감사로 자동 수집한다.
 * 결과 스크린샷은 test-results/inventory/, 감사 로그는 stdout(“[AUDIT]”)에 남긴다.
 *
 * 적대적 픽스처를 일부러 넣는다: 아주 긴 대상 제목, 좁은 창 폭. 정상 픽스처만으로는
 * 오버플로우가 드러나지 않기 때문이다.
 */

const OUT = join(__dirname, '..', 'test-results', 'inventory')

/**
 * 전역 오버플로우/겹침 감사. 세 신호를 모은다:
 *  1. clip-overflow — overflow:hidden/clip 인데 콘텐츠가 상자를 넘침(잘림 발생).
 *  2. spill-overflow — overflow:visible 인데 콘텐츠가 상자를 넘침(밖으로 삐져나옴).
 *  3. page-overflow — 뷰포트 가로 스크롤 유발(레이아웃 파손).
 * 넘침 판정은 컨테이너 포함 모든 요소에서 scrollWidth - clientWidth 로 한다.
 */
const AUDIT_FN = `(() => {
  const out = [{ meta: true, innerW: window.innerWidth, innerH: window.innerHeight }]
  const seen = new Set()
  const els = document.querySelectorAll('*')
  for (const el of els) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const overflowX = el.scrollWidth - el.clientWidth
    if (overflowX <= 1) continue
    const text = (el.textContent || '').trim().slice(0, 50)
    const cls = (el.className && el.className.toString) ? el.className.toString() : ''
    const clipped = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
    const scrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll'
    if (scrollable) continue // 의도된 스크롤 영역은 결함 아님
    const key = el.tagName + cls + text
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: clipped ? 'clip-overflow' : 'spill-overflow',
      tag: el.tagName.toLowerCase(),
      cls,
      text,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      over: overflowX,
      ellipsis: cs.textOverflow === 'ellipsis'
    })
  }
  const de = document.documentElement
  if (de.scrollWidth - de.clientWidth > 1) {
    out.push({ kind: 'page-overflow', scrollW: de.scrollWidth, clientW: de.clientWidth })
  }
  return out
})()`

async function audit(page: Page, label: string): Promise<void> {
  const findings = await page.evaluate(AUDIT_FN as unknown as () => unknown[])
  // eslint-disable-next-line no-console
  console.log(`[AUDIT] ${label} :: ${JSON.stringify(findings)}`)
}

/** 임시 녹화 폴더 픽스처. title 을 주입해 적대적(긴 제목) 케이스를 만든다. */
function makeFixture(title: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'recap-inv-'))
  const videoPath = join(folder, 'recording.mp4')
  copyFileSync(join(__dirname, 'fixtures', 'recording.mp4'), videoPath)
  const eventTrack = {
    protocolVersion: 1,
    startedAt: 1751710200000,
    durationMs: 4000,
    samples: [
      { t: 300, kind: 'move', x: 100, y: 100, cursor: 'arrow' },
      { t: 1000, kind: 'down', x: 320, y: 200, cursor: 'pointer' },
      { t: 1050, kind: 'up', x: 320, y: 200, cursor: 'pointer' }
    ]
  }
  writeFileSync(join(folder, 'events.json'), JSON.stringify(eventTrack), 'utf8')
  const manifest = {
    version: 1,
    videoPath,
    startedAt: eventTrack.startedAt,
    durationMs: eventTrack.durationMs,
    eventCount: eventTrack.samples.length,
    target: { kind: 'display', id: 'display:1', title, width: 640, height: 400 }
  }
  writeFileSync(join(folder, 'recording.json'), JSON.stringify(manifest), 'utf8')
  return folder
}

let app: ElectronApplication
let welcome: Page

test.describe.serial('UI 결함 인벤토리 (#135)', () => {
  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    const freshUserData = mkdtempSync(join(tmpdir(), 'recap-inv-ud-'))
    app = await electron.launch({
      args: [join(__dirname, '..', 'out', 'main', 'index.js')],
      env: { ...process.env, RECAP_USER_DATA_DIR: freshUserData }
    })
    welcome = await app.firstWindow()
  })

  test.afterAll(async () => {
    await app.evaluate(({ app: e }) => setTimeout(() => e.exit(0), 0))
    await app.close().catch(() => {})
  })

  test('온보딩 7단계 순회 — 각 단계 스크린샷 + 오버플로우 감사', async () => {
    await expect(welcome.locator('#root')).not.toBeEmpty()
    // 권한 게이트 우회: window.recap 은 contextBridge 로 노출된 불변 객체라 렌더러에서
    // 재할당이 안 된다 — main 의 ipcMain 핸들러를 직접 스텁한다. 두 권한을 granted 로
    // 돌려주고, false→true 전이가 띄우는 재시작 다이얼로그(confirmRestart)는 no-op 으로 막는다.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('permissions:status')
      ipcMain.handle('permissions:status', () => ({ screen: true, accessibility: true }))
      ipcMain.removeHandler('app:confirm-restart')
      ipcMain.handle('app:confirm-restart', () => undefined)
    })
    await welcome.waitForTimeout(500) // 250ms 폴이 새 상태를 반영하도록
    for (let i = 1; i <= 7; i++) {
      const stepNum = String(i).padStart(2, '0')
      await welcome.screenshot({ path: join(OUT, `onb-${stepNum}.png`) })
      await audit(welcome, `onboarding-step-${stepNum}`)
      // 다음 단계로. 권한 단계(1)는 canAdvance 게이팅이 있으나 개발 빌드에선
      // 권한이 granted 로 나오는 경우가 많다 — 버튼이 disabled 면 클릭 스킵.
      if (i < 7) {
        const next = welcome.locator('.welcome-btns button').last()
        const disabled = await next.isDisabled().catch(() => false)
        if (disabled) {
          console.log(`[AUDIT] onboarding-step-${stepNum} :: NEXT_DISABLED (게이팅으로 진행 불가)`)
          break
        }
        await next.click()
        await welcome.waitForTimeout(150)
      }
    }
  })

  test('에디터 — 아주 긴 대상 제목(오버플로우 유도) + 전역 감사', async () => {
    const longTitle =
      'Google Chrome — 아주 긴 브라우저 탭 제목이 상단 바를 넘치는지 확인하기 위한 적대적 테스트 문자열입니다'
    const folder = makeFixture(longTitle)
    const editorWindow = app.waitForEvent('window')
    await welcome.evaluate(
      (f) => (window as unknown as { recap: RecapApi }).recap.openEditor(f),
      folder
    )
    const editor = await editorWindow
    await expect(editor.locator('.editor-sidebar')).toBeVisible({ timeout: 15_000 })
    await editor.waitForTimeout(400)
    await editor.screenshot({ path: join(OUT, 'editor-long-title.png') })
    await audit(editor, 'editor-long-title-1200w')

    // 상단 바만 크롭해 오버플로우 여부를 명확히.
    const bar = editor.locator('.editor-bar')
    await bar.screenshot({ path: join(OUT, 'editor-bar-long-title.png') })

    // 좁은 창(narrow-window 미디어쿼리 820px 경계·에디터 minWidth 720px 밴드) 반응성 점검.
    // 렌더러 로드 후 창 제목이 문서 타이틀('Recap')로 바뀌므로, webContents URL 의 role 로 매칭한다.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('editor')
      )
      w?.setSize(760, 700)
    })
    await editor.waitForTimeout(500)
    await editor.screenshot({ path: join(OUT, 'editor-narrow-760.png') })
    await audit(editor, 'editor-narrow-760w')

    // export 팝오버 열어 감사(팝오버가 사이드바 위를 덮는지 스크린샷으로).
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('editor')
      )
      w?.setSize(1200, 760)
    })
    await editor.waitForTimeout(300)
    const exportBtn = editor.locator('.btn-export-primary')
    await exportBtn.click()
    await expect(editor.locator('.export-popover')).toBeVisible()
    await editor.waitForTimeout(200)
    await editor.screenshot({ path: join(OUT, 'editor-export-popover.png') })
    await audit(editor, 'editor-export-popover')
  })

  // 참고: 녹화 표면(툴바·REC pill·선택 오버레이 3종)은 실제 캡처 플로에서만 전용 크기의
  // 프레임리스 창으로 생성되고 화면권한을 요구한다. openWindow 로 강제 소환하면 기본
  // 프레임(1180×760)으로 열려 레이아웃이 왜곡되므로, 이 표면들은 라이브가 아니라
  // JSX+CSS 정적 분석으로 다룬다(인벤토리 §5 참조).

  test('라이브러리 창 — 실제 녹화물 카드 렌더 + 감사', async () => {
    const libWindow = app.waitForEvent('window')
    await welcome.evaluate(() =>
      (window as unknown as { recap: RecapApi }).recap.openWindow('library')
    )
    const lib = await libWindow
    await lib.waitForTimeout(600)
    await lib.screenshot({ path: join(OUT, 'library-empty.png') })
    await audit(lib, 'library-empty')
  })
})
