import { vi } from 'vite-plus/test'
import './app/styles/globals.css'

document.documentElement.dataset.theme = 'light'

;(
  globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('./test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock(),
  }
})
