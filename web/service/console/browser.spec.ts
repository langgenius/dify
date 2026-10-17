import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { CSRF_HEADER_NAME } from '@/config'
import { isHttpError } from '@/service/http-error'
import { getSentRequest } from '@/test/console/fetch'
import { consoleClient } from './index'

const mocks = vi.hoisted(() => ({
  refreshAccessTokenOrReLogin: vi.fn<(timeout: number) => Promise<void>>(),
}))

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
vi.mock('@/utils/var', () => ({ basePath: '/app' }))
vi.mock('../refresh-token', () => ({
  refreshAccessTokenOrReLogin: mocks.refreshAccessTokenOrReLogin,
}))

const unauthorized = () =>
  Response.json(
    { code: 'unauthorized', message: 'Invalid Authorization token.', status: 401 },
    { status: 401 },
  )
const profile = () => Response.json({ id: 'user-1', name: 'Test User' })

describe('console browser link', () => {
  const originalLocation = globalThis.location
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(toast, 'error').mockImplementation(() => '')
    mocks.refreshAccessTokenOrReLogin.mockReset()
    document.cookie = 'csrf_token=csrf-1; path=/'
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/app/apps',
        search: '',
        hash: '',
        href: 'https://example.com/app/apps',
        reload: vi.fn(),
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('sends cookies and the CSRF token with each request', async () => {
    fetchMock.mockResolvedValue(profile())

    await consoleClient.account.profile.get()

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include', mode: 'cors' })
    expect(getSentRequest(fetchMock).headers.get(CSRF_HEADER_NAME)).toBe('csrf-1')
  })

  it('answers 204 responses with the legacy success payload', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      consoleClient.workspaces.current.endpoints.byId.delete({ params: { id: 'endpoint-1' } }),
    ).resolves.toEqual({ result: 'success' })
  })

  it('decodes backend errors with their HTTP status and reports them once', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: 'invalid_param', message: 'Name is required' }, { status: 400 }),
    )

    const error = await consoleClient.account.profile.get().catch((error: unknown) => error)

    expect(isHttpError(error)).toBe(true)
    expect(error).toMatchObject({ code: 'invalid_param', message: 'Name is required', status: 400 })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Name is required')
  })

  it('keeps backend errors quiet for silent calls', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Name is required' }, { status: 400 }))

    await expect(
      consoleClient.account.profile.get(undefined, { context: { silent: true } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps the HTTP status when an error body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(consoleClient.account.profile.get()).rejects.toMatchObject({
      status: 502,
      data: undefined,
    })
  })

  it('retries with the rotated CSRF token after refreshing an expired access token', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockImplementationOnce(async (_url, init) =>
        new Headers(init?.headers).get(CSRF_HEADER_NAME) === 'csrf-2' ? profile() : unauthorized(),
      )
    mocks.refreshAccessTokenOrReLogin.mockImplementation(async () => {
      document.cookie = 'csrf_token=csrf-2; path=/'
    })

    await expect(consoleClient.account.profile.get()).resolves.toMatchObject({ id: 'user-1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.refreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
  })

  it('preserves caller cancellation without native AbortSignal.any', async () => {
    const LegacyAbortSignal = class extends AbortSignal {}
    Object.defineProperty(LegacyAbortSignal, 'any', { value: undefined })
    vi.stubGlobal('AbortSignal', LegacyAbortSignal)
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          })
          markStarted()
        }),
    )

    const reason = new DOMException('Cancelled by caller', 'AbortError')
    const request = consoleClient.account.profile.get(undefined, { signal: controller.signal })
    const rejection = expect(request).rejects.toBe(reason)
    await started

    controller.abort(reason)
    await rejection
  })

  it('aborts a stalled request at the console timeout', async () => {
    vi.useFakeTimers()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          })
          markStarted()
        }),
    )

    const request = consoleClient.account.profile.get()
    const rejection = expect(request).rejects.toThrow(/timed out|timeout/i)
    await started
    await vi.advanceTimersByTimeAsync(99_999)
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })

  it('does not refresh twice when the retried request is still unauthorized', async () => {
    fetchMock.mockImplementation(async () => unauthorized())
    mocks.refreshAccessTokenOrReLogin.mockResolvedValue()

    await expect(consoleClient.account.profile.get()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.refreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
  })

  it('sends the user to sign in when the refresh fails', async () => {
    fetchMock.mockResolvedValue(unauthorized())
    mocks.refreshAccessTokenOrReLogin.mockRejectedValue(new Error('refresh failed'))

    await expect(consoleClient.account.profile.get()).rejects.toMatchObject({ status: 401 })
    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps')}`,
    )
    expect(toast.error).not.toHaveBeenCalled()
  })
})
