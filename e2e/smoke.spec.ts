import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

/**
 * 앱 기동 스모크 테스트(#102). `electron-vite build` 산출물(out/main/index.js)을
 * 실제 Electron으로 기동해 첫 창(BrowserWindow)이 뜨고 렌더러가 그려지는지 확인한다.
 *
 * 앱은 메뉴바 전용(#110 이후 부팅 시 창 없음)이라, RECAP_USER_DATA_DIR 로
 * userData 를 임시 디렉터리로 돌려 첫 실행 상태로 기동한다 — 온보딩 미완료면
 * Welcome 창(#80)이 자동 소환되는 것이 유일한 결정적 부팅 창이다. 렌더러(#root)와
 * 문서 타이틀 'Recap' 불변식을 검증한다. 화면녹화 권한이 필요한 캡처 플로우는 제외.
 */

let app: ElectronApplication
let firstWindow: Page

test.beforeAll(async () => {
  const freshUserData = mkdtempSync(join(tmpdir(), 'recap-e2e-'))
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, RECAP_USER_DATA_DIR: freshUserData }
  })
  firstWindow = await app.firstWindow()
})

test.afterAll(async () => {
  // 메뉴바 상주 앱이라 창을 닫아도 프로세스가 남는다 — main 프로세스에
  // 직접 exit을 걸어 확실히 내린다.
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.exit(0), 0)
  })
  await app.close().catch(() => {})
})

test('부팅 시 첫 창이 만들어지고 표시된다', async () => {
  const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  expect(count).toBeGreaterThan(0)
  // 창은 ready-to-show 후에야 show()되므로 즉시가 아니라 폴링으로 가시성을 기다린다.
  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) => w.isVisible())
        ),
      { timeout: 15_000 }
    )
    .toBe(true)
})

test('첫 창 렌더러가 React 루트를 그린다', async () => {
  await expect(firstWindow.locator('#root')).not.toBeEmpty()
  expect(await firstWindow.title()).toContain('Recap')
})
