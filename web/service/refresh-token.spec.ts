import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@/config', () => ({
  API_PREFIX: '/console/api',
  CSRF_COOKIE_NAME: () => 'csrf_token',
  CSRF_HEADER_NAME: 'X-CSRF-Token',
}))

const fetchMock = vi.fn<typeof fetch>()

async function loadTab() {
  vi.resetModules()
  return (await import('./refresh-token')).refreshAccessTokenOrReLogin
}

function pendingResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

function enableWebLocks() {
  let pending = Promise.resolve()
  const request = vi.fn((_name: string, callback: () => Promise<void>) => {
    const result = pending.then(callback)
    pending = result.catch(() => {})
    return result
  })
  vi.stubGlobal('navigator', { locks: { request } })
  return request
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  document.cookie = 'csrf_token=; Max-Age=0; Path=/'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('refreshAccessTokenOrReLogin', () => {
  it('shares one request between callers when Web Locks is unavailable', async () => {
    const refresh = await loadTab()
    const response = pendingResponse()
    fetchMock.mockReturnValue(response.promise)

    const first = refresh(10000)
    const second = refresh(10000)
    expect(fetchMock).toHaveBeenCalledOnce()
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('X-Refresh-Request-ID')).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/i,
    )
    expect(headers.get('X-CSRF-Token')).toBe('')

    response.resolve(new Response())
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one idempotency ID across tabs without Web Locks, and a new ID after rotation', async () => {
    document.cookie = 'csrf_token=initial-csrf-token; Path=/'
    const firstTab = await loadTab()
    const secondTab = await loadTab()
    const response = pendingResponse()
    fetchMock.mockReturnValue(response.promise)

    const first = firstTab(10000)
    const second = secondTab(10000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    const requestId = firstHeaders.get('X-Refresh-Request-ID')
    expect(requestId).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/i)
    expect(secondHeaders.get('X-Refresh-Request-ID')).toBe(requestId)
    expect(firstHeaders.get('X-CSRF-Token')).toBe('initial-csrf-token')
    expect(secondHeaders.get('X-CSRF-Token')).toBe('initial-csrf-token')

    document.cookie = 'csrf_token=next-csrf-token; Path=/'
    response.resolve(new Response())
    await Promise.all([first, second])
    await firstTab(10000)
    const nextHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers)
    expect(nextHeaders.get('X-Refresh-Request-ID')).not.toBe(requestId)
    expect(nextHeaders.get('X-CSRF-Token')).toBe('next-csrf-token')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets queued tabs reuse the cookies refreshed by the lock owner', async () => {
    const requestLock = enableWebLocks()
    const firstTab = await loadTab()
    const secondTab = await loadTab()
    const response = pendingResponse()
    fetchMock.mockReturnValue(response.promise)

    const first = firstTab(10000)
    const second = secondTab(10000)
    await vi.advanceTimersByTimeAsync(0)
    expect(requestLock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledOnce()

    document.cookie = 'csrf_token=rotated-csrf-token; Path=/'
    response.resolve(new Response())
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not cancel shared refresh when one caller times out', async () => {
    const refresh = await loadTab()
    const response = pendingResponse()
    fetchMock.mockReturnValue(response.promise)
    const impatient = expect(refresh(20)).rejects.toThrow('request timeout')
    const patient = refresh(10000)

    await vi.advanceTimersByTimeAsync(20)
    await impatient
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    const anotherCaller = refresh(10000)
    expect(fetchMock).toHaveBeenCalledOnce()

    response.resolve(new Response())
    await Promise.all([patient, anotherCaller])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a lost response with the same idempotency ID and current CSRF cookie', async () => {
    document.cookie = 'csrf_token=initial-csrf-token; Path=/'
    const refresh = await loadTab()
    fetchMock.mockImplementationOnce(() => {
      document.cookie = 'csrf_token=next-csrf-token; Path=/'
      return Promise.reject(new TypeError('network interrupted'))
    })
    fetchMock.mockResolvedValueOnce(new Response())

    await refresh(10000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstOptions = fetchMock.mock.calls[0]?.[1]
    const secondOptions = fetchMock.mock.calls[1]?.[1]
    const requestId = new Headers(firstOptions?.headers).get('X-Refresh-Request-ID')
    expect(requestId).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i)
    expect(new Headers(secondOptions?.headers).get('X-Refresh-Request-ID')).toBe(requestId)
    expect(new Headers(firstOptions?.headers).get('X-CSRF-Token')).toBe('initial-csrf-token')
    expect(new Headers(secondOptions?.headers).get('X-CSRF-Token')).toBe('next-csrf-token')
    expect(firstOptions).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry outside the idempotency window after the browser was suspended', async () => {
    const refresh = await loadTab()
    const failure = new TypeError('network interrupted')
    fetchMock.mockImplementationOnce(() => {
      vi.setSystemTime(Date.now() + 11000)
      return Promise.reject(failure)
    })

    await expect(refresh(20000)).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([400, 401, 403, 500, 503])(
    'rejects HTTP %s as ORPCError without retrying or stranding later callers',
    async (status) => {
      const refresh = await loadTab()
      const response = Response.json(
        { code: 'refresh_failed', message: 'Refresh failed' },
        { status },
      )
      fetchMock.mockResolvedValueOnce(response)

      const error = await refresh(10000).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({ code: 'refresh_failed', message: 'Refresh failed', status })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)

      fetchMock.mockResolvedValueOnce(new Response())
      await expect(refresh(10000)).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )

  it('does not mistake another tab’s failed refresh for success', async () => {
    enableWebLocks()
    const firstTab = await loadTab()
    const secondTab = await loadTab()
    const response = new Response(null, { status: 500 })
    fetchMock.mockResolvedValueOnce(response)
    fetchMock.mockResolvedValueOnce(new Response())

    const first = expect(firstTab(10000)).rejects.toMatchObject({ status: 500 })
    const second = secondTab(10000)
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds hanging network requests and releases refresh after retry exhaustion', async () => {
    const refresh = await loadTab()
    fetchMock.mockImplementation(
      (_, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        }),
    )
    const result = expect(refresh(10000)).rejects.toHaveProperty('name', 'AbortError')

    await vi.advanceTimersByTimeAsync(8000)
    await result
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)

    fetchMock.mockResolvedValueOnce(new Response())
    await expect(refresh(10000)).resolves.toBeUndefined()
  })

  it('refreshes when the browser denies access to local storage', async () => {
    const refresh = await loadTab()
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Access denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('Access denied', 'SecurityError')
      },
    })
    fetchMock.mockResolvedValueOnce(new Response())

    await expect(refresh(10000)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
