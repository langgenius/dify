import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
// oxlint-disable-next-line no-restricted-imports -- Exercise the HTTP transport and auth recovery together.
import { request } from './base'
import { consoleClient } from './console'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('./refresh-token', () => ({ refreshAccessTokenOrReLogin: refresh }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  refresh.mockReset()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => vi.restoreAllMocks())

describe('HTTP failure contract', () => {
  it.each([400, 403, 404, 422, 429, 500, 503])(
    'exposes status %s as an Error with reusable metadata',
    async (status) => {
      const body = {
        code: 'operation_failed',
        message: 'Could not save',
        status: 200,
        reason: 'WORKSPACE_UNAVAILABLE',
        hint: 'Try again later',
        details: [{ loc: ['name'], msg: 'Required', type: 'missing' }],
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(body, {
          status,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '10',
            'X-Request-Id': 'request-123',
          },
        }),
      )

      const error = await request('/test-errors', { body: {}, method: 'POST' }).catch(
        (error: unknown) => error,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(ORPCError)
      if (!(error instanceof ORPCError)) throw new TypeError('Expected an HTTP failure')
      expect(error).toMatchObject({
        code: body.code,
        message: body.message,
        status,
        data: body,
        defined: false,
      })
      expect(error.cause).toEqual({
        headers: new Headers({
          'Content-Type': 'application/json',
          'Retry-After': '10',
          'X-Request-Id': 'request-123',
        }),
      })
      expect(String(error)).toBe('Error: Could not save')
      expect(error.data).toEqual(body)
    },
  )

  it.each(['', '<html>Bad gateway</html>', '{invalid', 'null', '[]'])(
    'handles a non-contract response body: %s',
    async (body) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(body, { status: 502, statusText: 'Bad Gateway' }),
      )
      await expect(request('/test-errors', { method: 'GET' })).rejects.toMatchObject({
        defined: false,
        message: 'Bad Gateway',
        status: 502,
      })
    },
  )

  it('accepts the legacy error field and uses a status fallback for invalid messages', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch.mockResolvedValueOnce(Response.json({ error: 'Upload rejected' }, { status: 413 }))
    await expect(request('/test-errors', { method: 'POST' })).rejects.toMatchObject({
      message: 'Upload rejected',
      status: 413,
    })
    fetch.mockResolvedValueOnce(
      Response.json({ message: { internal: 'invalid' } }, { status: 500 }),
    )
    await expect(request('/test-errors', { method: 'GET' })).rejects.toMatchObject({
      message: 'HTTP 500',
      status: 500,
    })
  })

  it('keeps login failures as ORPCError instead of rejecting a plain object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ code: 'invalid_credentials', message: 'Invalid password' }, { status: 401 }),
    )
    await expect(request('/login', { method: 'POST' })).rejects.toMatchObject({
      defined: false,
      code: 'invalid_credentials',
      message: 'Invalid password',
      status: 401,
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('retries after token refresh and normalizes the retried HTTP failure', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 'unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ code: 'forbidden', message: 'Access denied' }, { status: 403 }),
      )
    refresh.mockResolvedValue(undefined)
    await expect(request('/test-errors', { method: 'GET' })).rejects.toMatchObject({
      defined: false,
      message: 'Access denied',
      status: 403,
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([429, 503])(
    'keeps the session when token refresh fails with transient HTTP %s',
    async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ code: 'unauthorized' }, { status: 401 }),
      )
      const refreshError = new ORPCError('HTTP_ERROR', { status })
      refresh.mockRejectedValue(refreshError)
      const initialUrl = window.location.href

      await expect(request('/test-errors', { method: 'GET' })).rejects.toBe(refreshError)
      expect(refresh).toHaveBeenCalledOnce()
      expect(window.location.href).toBe(initialUrl)
    },
  )

  it('does not treat 3xx responses as HTTP failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 304 }))

    await expect(
      request<Response>('/test-errors', {}, { needAllResponseContent: true }),
    ).resolves.toMatchObject({ status: 304 })
  })

  it('preserves network and abort errors without inventing HTTP status codes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    for (const error of [
      new TypeError('Failed to fetch'),
      new DOMException('Cancelled', 'AbortError'),
    ]) {
      fetch.mockRejectedValueOnce(error)
      const caught = await request('/test-errors', {}).catch((error: unknown) => error)
      expect(caught).toBeInstanceOf(Error)
      expect(caught).not.toBeInstanceOf(ORPCError)
      if (error.name === 'AbortError') expect(caught).toBe(error)
      else expect(caught).toMatchObject({ name: 'NetworkError', cause: error })
    }
  })

  it('preserves cancellation while reading a 401 body without starting authentication recovery', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('Cancelled while reading the response', 'AbortError')
    let resolveBodyRead: () => void
    const bodyRead = new Promise<void>((resolve) => {
      resolveBodyRead = resolve
    })
    const initialUrl = window.location.href
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const signal = (input as Request).signal
      return new Response(
        new ReadableStream(
          {
            start(body) {
              signal.addEventListener('abort', () => body.error(signal.reason), { once: true })
            },
            pull() {
              resolveBodyRead()
            },
          },
          { highWaterMark: 0 },
        ),
        { status: 401 },
      )
    })

    const pending = request('/test-errors', { method: 'GET', signal: controller.signal }).catch(
      (error: unknown) => error,
    )
    await bodyRead
    controller.abort(abortError)

    expect(await pending).toBe(abortError)
    expect(refresh).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(window.location.href).toBe(initialUrl)
  })

  it('preserves ORPCError through the generated Console client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ code: 'forbidden', message: 'Profile is read-only' }, { status: 403 }),
    )
    const error = await consoleClient.account.profile.get({}).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ message: 'Profile is read-only', status: 403, code: 'forbidden' })
  })
})
