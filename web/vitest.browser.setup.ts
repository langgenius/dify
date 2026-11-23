import { vi } from 'vite-plus/test'
import { page, server, userEvent } from 'vite-plus/test/browser'
import { consoleErrorAllowlist } from './test/console-error-allowlist'
import './app/styles/globals.css'

document.documentElement.dataset.theme = 'light'

;(
  globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true

const allowedConsoleErrorFiles = new Set(consoleErrorAllowlist)
const writeConsoleError = console.error.bind(console)
let consoleErrors: unknown[][] = []

// Request failures the test itself produced, such as `apiError()` from the fake API.
const simulatedRequestFailures = vi.hoisted(() => new WeakSet<object>())

// boundary: the API clients log every failed request; a failure answered by a stubbed `fetch`
// (the fake API or `guardUnexpectedFetch`) is the scenario, so the guard below skips that error
// wherever it is logged. A request that reached the real network still fails the test.
vi.mock(import('@/service/client-error'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    reportClientError(error: unknown) {
      if (error && typeof error === 'object' && vi.isMockFunction(globalThis.fetch))
        simulatedRequestFailures.add(error)
      actual.reportClientError(error)
    },
  }
})

const isSimulatedRequestFailure = (value: unknown) =>
  !!value && typeof value === 'object' && simulatedRequestFailures.has(value)

// Fail a test that logs `console.error`. A spec that expects one silences it with
// `vi.spyOn(console, 'error').mockImplementation(…)`, which replaces this recorder.
beforeEach(() => {
  consoleErrors = []
  console.error = (...args: unknown[]) => {
    if (!args.some(isSimulatedRequestFailure)) consoleErrors.push(args)
    writeConsoleError(...args)
  }
})

afterEach(({ task }) => {
  const errors = consoleErrors
  consoleErrors = []
  if (!errors.length) return
  const file = task.file.filepath
  if ([...allowedConsoleErrorFiles].some((entry) => file.endsWith(`/${entry}`))) return
  const messages = errors.map((args) => args.map((arg) => String(arg)).join(' ')).join('\n\n')
  throw new Error(`Test logged console.error:\n\n${messages}`)
})

// Tests in one file share a page, so the viewport and pointer position outlive the test that set them.
beforeEach(async () => {
  const { width, height } = server.config.browser.viewport
  await page.viewport(width, height)
  // Move outside the test viewport without waiting for body hover actionability.
  await userEvent.pointer({ coords: { x: -1, y: -1 } })
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('./test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock(),
  }
})
