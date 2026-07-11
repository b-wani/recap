import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

/**
 * 앱 기동 스모크 테스트(#102). `electron-vite build` 산출물(out/main/index.js)을
 * 실제 Electron으로 기동해 첫 창(BrowserWindow)이 뜨고 렌더러가 그려지는지 확인한다.
 *
 * 앱은 메뉴바 상주형이지만 부팅 시 반드시 창 하나를 만든다 — 온보딩 완료 전에는
 * Welcome 창(#80), 완료 후에는 shell 창. 어느 쪽이든 같은 렌더러(index.html,
 * #root)를 싣고 문서 타이틀은 'Recap'이므로 그 공통 불변식만 검증한다.
 * macOS 화면녹화 권한이 필요한 캡처 플로우는 스모크 범위에서 제외한다.
 */

let app: ElectronApplication
let firstWindow: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')]
  })
  firstWindow = await app.firstWindow()
})

test.afterAll(async () => {
  // shell 창은 닫기=숨김(메뉴바 상주)이라 일반 종료 경로가 막혀 있다 — main 프로세스에
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
