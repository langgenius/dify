import { vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import './app/styles/globals.css'

document.documentElement.dataset.theme = 'light'

;(
  globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true

// Tests in one file share a page, so the viewport and pointer position outlive the test that set them.
beforeEach(async () => {
  await page.viewport(414, 896)
  await userEvent.unhover(document.body)
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('./test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock(),
  }
})
