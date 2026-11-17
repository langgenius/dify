import { waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import {
  appAccessErrorAtom,
  appAccessStore,
  captureAppAccessScope,
} from '@/features/app-access-error/state'
import { createDeferred } from '@/test/deferred'
// oxlint-disable-next-line no-restricted-imports -- Exercise identity retirement through the real public JSON and SSE transports.
import { request, sseGet, ssePost } from '../base'
import * as requestGuard from '../request-guard'
import { getWebAppPassport, setWebAppAccessToken, setWebAppPassport } from '../webapp-auth'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const address = { kind: 'default', code: 'race-app' } as const
const denied = {
  code: 'ip_access_denied',
  message: 'Old account denied',
  client_ip: '203.0.113.42',
}

function delayedErrorResponse(status: number) {
  const reading = createDeferred()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        start(streamController) {
          controller = streamController
        },
        pull() {
          reading.resolve()
        },
      },
      { highWaterMark: 0 },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
  return {
    response,
    reading: reading.promise,
    complete(body: object) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(body)))
      controller.close()
    },
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  captureAppAccessScope()
  window.history.replaceState({}, '', '/chat/race-app')
  captureAppAccessScope()
  setWebAppAccessToken('account-a', 'end_user')
  setWebAppPassport(address, 'account-a-passport')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  appAccessStore.set(appAccessErrorAtom, null)
  window.history.replaceState({}, '', '/')
  captureAppAccessScope()
})

it.each([
  { status: 403, body: denied },
  { status: 500, body: { code: 'server_error', message: 'Old request failed' } },
  { status: 401, body: { code: 'unauthorized', message: 'Old account expired' } },
])(
  'retires a JSON $status error after the account changes while its body is pending',
  async ({ status, body }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const readBody = vi.spyOn(Response.prototype, 'json')
    const pending = delayedErrorResponse(status)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pending.response)
    // oxlint-disable-next-line typescript/no-deprecated -- Reproduce the stale JSON error through the legacy transport owner being fixed.
    const result = request('/site', {}, { isPublicAPI: true }).catch((error: unknown) => error)
    await pending.reading
    await waitFor(() => expect(readBody).toHaveBeenCalled())
    setWebAppAccessToken('account-b', 'end_user')
    setWebAppPassport(address, 'account-b-passport')
    pending.complete(body)

    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(getWebAppPassport(address)).toBe('account-b-passport')
  },
)

it('preserves a real IP denial for the unchanged account', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(denied, { status: 403 }))
  // oxlint-disable-next-line typescript/no-deprecated -- Verify the same legacy transport still surfaces a current-account access denial.
  await expect(request('/site', {}, { isPublicAPI: true })).rejects.toMatchObject({ status: 403 })
  expect(appAccessStore.get(appAccessErrorAtom)).toMatchObject({ reason: 'ip_access_denied' })
  expect(toast.error).not.toHaveBeenCalled()
})

describe.each([
  // oxlint-disable-next-line typescript/no-deprecated -- Exercise the special POST transport's async error boundary.
  { method: 'POST', send: ssePost },
  // oxlint-disable-next-line typescript/no-deprecated -- Exercise the separate GET transport's async error boundary.
  { method: 'GET', send: sseGet },
])('public SSE $method', ({ send }) => {
  it.each([
    { status: 403, body: denied, guard: true },
    { status: 401, body: { code: 'unauthorized', message: 'Old account expired' }, guard: false },
    { status: 500, body: { code: 'server_error', message: 'Old request failed' }, guard: false },
  ])(
    'ignores a delayed $status body from the previous account',
    async ({ status, body, guard }) => {
      if (!guard) vi.spyOn(requestGuard, 'captureRequestGuard').mockReturnValue(undefined)
      const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
      const readBody = vi.spyOn(Response.prototype, 'json')
      const pending = delayedErrorResponse(status)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(pending.response)
      const onError = vi.fn()
      const onCompleted = vi.fn()
      const onNotifyError = vi.fn()
      await send('/chat-messages', {}, { isPublicAPI: true, onError, onCompleted, onNotifyError })
      await pending.reading
      setWebAppAccessToken('account-b', 'end_user')
      setWebAppPassport(address, 'account-b-passport')
      pending.complete(body)
      await waitFor(() => expect(readBody).toHaveResolvedWith(body))

      expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
      expect(onError).not.toHaveBeenCalled()
      expect(onCompleted).not.toHaveBeenCalled()
      expect(onNotifyError).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
      expect(getWebAppPassport(address)).toBe('account-b-passport')
    },
  )

  it('preserves the unchanged account’s real IP denial without a generic notification', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(denied, { status: 403 }))
    await send('/chat-messages', {}, { isPublicAPI: true, onError, onNotifyError })
    await waitFor(() => expect(onError).toHaveBeenCalledWith(denied.message, denied.code))
    expect(appAccessStore.get(appAccessErrorAtom)).toMatchObject({ reason: 'ip_access_denied' })
    expect(onNotifyError).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps a genuine current-account server error visible to its owner', async () => {
    const body = { code: 'server_error', message: 'Current request failed' }
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status: 500 }))
    await send('/chat-messages', {}, { isPublicAPI: true, onError, onNotifyError })
    await waitFor(() => expect(onNotifyError).toHaveBeenCalledWith(body.message, body.code))
    expect(onError).toHaveBeenCalledWith(body.message, body.code)
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
  })

  it('does not notify for a public request canceled while its error body is pending', async () => {
    vi.spyOn(requestGuard, 'captureRequestGuard').mockReturnValue(undefined)
    const body = { code: 'server_error', message: 'Canceled request failed' }
    const readBody = vi.spyOn(Response.prototype, 'json')
    const pending = delayedErrorResponse(500)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pending.response)
    const controller = createDeferred<AbortController>()
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    await send(
      '/chat-messages',
      {},
      {
        isPublicAPI: true,
        onError,
        onNotifyError,
        getAbortController: controller.resolve,
      },
    )
    await pending.reading
    ;(await controller.promise).abort()
    pending.complete(body)
    await waitFor(() => expect(readBody).toHaveResolvedWith(body))
    expect(onError).not.toHaveBeenCalled()
    expect(onNotifyError).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
