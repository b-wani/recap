import { defineConfig } from '@playwright/test'

/**
 * E2E 스모크 테스트 설정(#102). 대상은 `electron-vite build` 산출물(out/)을
 * `_electron.launch`로 기동한 실제 Electron 앱이다. 단위 테스트(vitest,
 * src 하위 *.test.ts)와 겹치지 않도록 e2e/ 디렉터리만 스캔한다.
 */
export default defineConfig({
  testDir: 'e2e',
  // Electron 앱 인스턴스는 전역 자원(단축키·트레이 등록 등)이라 직렬 실행한다.
  workers: 1,
  timeout: 60_000,
  reporter: [['list']]
})
