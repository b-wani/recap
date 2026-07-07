import type { RecapApi } from './index'

declare global {
  interface Window {
    recap: RecapApi
  }
}
