import { page, server, userEvent } from 'vite-plus/test/browser'
import './vitest.css'

document.documentElement.dataset.theme = 'light'

;(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

// Tests in one file share a page, so the viewport and pointer position outlive the test that set them.
beforeEach(async () => {
  const { width, height } = server.config.browser.viewport
  await page.viewport(width, height)
  await userEvent.unhover(document.body)
})
