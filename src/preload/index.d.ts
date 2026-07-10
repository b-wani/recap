import type { HoppyApi } from './index'

declare global {
  interface Window {
    hoppy: HoppyApi
  }
}
