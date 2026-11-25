import { vi } from 'vite-plus/test'
import { page, server, userEvent } from 'vite-plus/test/browser'
import { cleanup } from 'vitest-browser-react'
import { consoleErrorAllowlist } from './test/console-error-allowlist'
import './app/styles/globals.css'

document.documentElement.dataset.theme = 'light'

;(
  globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true

// boundary: Monaco terminates its editor worker as soon as the last model is disposed, which in a
// spec is often within milliseconds of creating it. Chromium reports the `importScripts` that the
// termination cancels as an uncaught window error (`… workerMain.js … failed to load`), and the
// guard below then fails whichever test is running. Terminate only after the worker has loaded.
const NativeWorker = window.Worker
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    if (options?.name !== 'editorWorkerService') return
    const loaded = new Promise<void>((resolve) => {
      this.addEventListener('message', () => resolve(), { once: true })
      this.addEventListener('error', () => resolve(), { once: true })
      setTimeout(resolve, 300)
    })
    const terminate = this.terminate.bind(this)
    this.terminate = () => {
      void loaded.then(terminate)
    }
  }
}

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

// boundary: Chromium reports a ResizeObserver whose callbacks resized an observed element as an
// `ErrorEvent` with no error object; the remaining notifications are delivered in the next frame.
// Vitest logs that event through `console.error`. Under CI load it reaches specs whose components
// observe nothing themselves (floating-ui positioners, canvases), so the guard ignores exactly
// this message. A spec that checks for a real resize loop listens for the window `error` event.
const isResizeObserverLoopNotice = (value: unknown) =>
  value instanceof Error &&
  value.message === 'ResizeObserver loop completed with undelivered notifications.'

// Fail a test that logs `console.error`. A spec that expects one silences it with
// `vi.spyOn(console, 'error').mockImplementation(…)`, which replaces this recorder.
beforeEach(() => {
  consoleErrors = []
  console.error = (...args: unknown[]) => {
    if (!args.some(isSimulatedRequestFailure) && !args.every(isResizeObserverLoopNotice))
      consoleErrors.push(args)
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

// Unmount rendered trees when the test ends rather than when the next one starts. A tree left
// mounted keeps re-rendering after the spec's `onTestFinished` cleanups (such as clearing its query
// client) and after the fake API restores the real transports, so its refetches reach a missing
// handler or the real network and fail this or the next test. `afterEach` hooks run in reverse, so
// this runs before the guard above and its errors stay with this test. Failure screenshots are
// taken before `afterEach`.
afterEach(cleanup)

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
