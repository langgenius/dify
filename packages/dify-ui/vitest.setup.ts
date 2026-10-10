import { page, userEvent } from 'vite-plus/test/browser'
import './vitest.css'

document.documentElement.dataset.theme = 'light'

;(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

// Tests in one file share a page, so the viewport and pointer position outlive the test that set them.
beforeEach(async () => {
  await page.viewport(414, 896)
  await userEvent.unhover(document.body)
})
