import { ORPCError } from '@orpc/client'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
// oxlint-disable-next-line no-restricted-imports -- Exercise the HTTP transport and auth recovery together.
import { get, post, request, upload } from './base'
import { consoleClient } from './console'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('./refresh-token', () => ({ refreshAccessTokenOrReLogin: refresh }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  refresh.mockReset()
})

describe('upload HTTP failure contract', () => {
  const createUpload = (status: number, response: unknown) => {
    const xhr = new XMLHttpRequest()
    vi.spyOn(xhr, 'open').mockImplementation(() => {})
    vi.spyOn(xhr, 'setRequestHeader').mockImplementation(() => {})
    vi.spyOn(xhr, 'getAllResponseHeaders').mockReturnValue('X-Request-Id: upload-123\r\n')
    Object.defineProperties(xhr, {
      readyState: { value: 1, configurable: true },
      status: { value: status },
      statusText: { value: '' },
      response: { value: response },
    })
    vi.spyOn(xhr, 'send').mockImplementation(() => {
      Object.defineProperty(xhr, 'readyState', { value: 4 })
      xhr.dispatchEvent(new Event('readystatechange'))
    })
    return xhr
  }

  it.each([200, 201])('resolves successful HTTP %s uploads', async (status) => {
    const response = { id: 'file-1' }
    await expect(
      upload({ xhr: createUpload(status, response), data: new FormData() }),
    ).resolves.toEqual(response)
  })

  it('rejects HTTP failures with the same ORPCError as fetch requests', async () => {
    const data = {
      code: 'file_extension_blocked',
      message: 'File type not allowed',
      details: { request_id: 'upload-123' },
    }
    const error = await upload({ xhr: createUpload(400, data), data: new FormData() }).catch(
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      code: data.code,
      message: data.message,
      status: 400,
      data,
    })
    if (!(error instanceof ORPCError)) throw new Error('Expected an upload HTTP failure')
    expect(error.cause).toEqual({ headers: new Headers({ 'X-Request-Id': 'upload-123' }) })
  })

  it.each([
    ['error', 'TypeError'],
    ['abort', 'AbortError'],
    ['timeout', 'TimeoutError'],
  ])('keeps upload %s distinct from HTTP failures', async (event, name) => {
    const xhr = createUpload(0, null)
    vi.mocked(xhr.send).mockImplementation(() => {
      Object.defineProperty(xhr, 'readyState', { value: 4 })
      xhr.dispatchEvent(new Event('readystatechange'))
      xhr.dispatchEvent(new Event(event))
    })
    await expect(upload({ xhr, data: new FormData() })).rejects.toMatchObject({ name })
  })
})

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

      const error = await post('/test-errors', { body: {} }, { silent: true }).catch(
        (error: unknown) => error,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(ORPCError)
      if (!(error instanceof ORPCError)) throw new Error('Expected an HTTP failure')
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
      await expect(get('/test-errors', {}, { silent: true })).rejects.toMatchObject({
        defined: false,
        message: 'Bad Gateway',
        status: 502,
      })
    },
  )

  it('accepts the legacy error field and uses a status fallback for invalid messages', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch.mockResolvedValueOnce(Response.json({ error: 'Upload rejected' }, { status: 413 }))
    await expect(post('/test-errors', {}, { silent: true })).rejects.toMatchObject({
      message: 'Upload rejected',
      status: 413,
    })
    fetch.mockResolvedValueOnce(
      Response.json({ message: { internal: 'invalid' } }, { status: 500 }),
    )
    await expect(get('/test-errors', {}, { silent: true })).rejects.toMatchObject({
      message: 'HTTP 500',
      status: 500,
    })
  })

  it('keeps login failures as ORPCError instead of rejecting a plain object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ code: 'invalid_credentials', message: 'Invalid password' }, { status: 401 }),
    )
    await expect(post('/login', {}, { silent: true })).rejects.toMatchObject({
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
    await expect(get('/test-errors', {}, { silent: true })).rejects.toMatchObject({
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

      await expect(get('/test-errors', {}, { silent: true })).rejects.toBe(refreshError)
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
      const caught = await request('/test-errors', {}, { silent: true }).catch(
        (error: unknown) => error,
      )
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

    const pending = get('/test-errors', { signal: controller.signal }).catch(
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
    const error = await consoleClient.account.profile
      .get({}, { context: { silent: true } })
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ message: 'Profile is read-only', status: 403, code: 'forbidden' })
  })
})
