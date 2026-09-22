import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@/config', () => ({ API_PREFIX: 'https://example.com/console/api' }))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const loadRefresh = async () => {
  vi.resetModules()
  return (await import('./refresh-token')).refreshAccessTokenOrReLogin
}

const createLocks = () => {
  let previous = Promise.resolve()
  return {
    request: vi.fn((_name: string, options: LockOptions, callback: () => Promise<void>) => {
      const released = deferred<void>()
      const current = previous
      previous = released.promise
      return current
        .then(() => {
          options.signal?.throwIfAborted()
          return callback()
        })
        .finally(() => released.resolve())
    }),
  }
}

describe('Console session refresh', () => {
  const network = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()
    network.mockReset()
    vi.stubGlobal('fetch', network)
    vi.stubGlobal('navigator', {})
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shares one successful refresh and clears its deadline', async () => {
    const response = deferred<Response>()
    network.mockReturnValue(response.promise)
    const refresh = await loadRefresh()
    const first = refresh(1000)
    const second = refresh(1000)

    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    response.resolve(new Response('{}'))

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(network).toHaveBeenCalledWith(
      'https://example.com/console/api/refresh-token',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([401, 500])(
    'shares a refresh HTTP %s failure without another request',
    async (status) => {
      const response = deferred<Response>()
      network.mockReturnValue(response.promise)
      const refresh = await loadRefresh()
      const results = Promise.allSettled([refresh(1000), refresh(1000)])

      await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
      response.resolve(new Response('{}', { status }))
      await vi.advanceTimersByTimeAsync(1000)

      const settled = await results
      expect(settled.map((result) => result.status)).toEqual(['rejected', 'rejected'])
      expect(settled[1]).toEqual(settled[0])
      expect(network).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('shares network failure and allows a later refresh to succeed', async () => {
    const response = deferred<Response>()
    network.mockReturnValueOnce(response.promise).mockResolvedValue(new Response('{}'))
    const refresh = await loadRefresh()
    const results = Promise.allSettled([refresh(1000), refresh(1000)])

    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    response.reject(new TypeError('Failed to fetch'))
    await vi.advanceTimersByTimeAsync(1000)

    const settled = await results
    expect(settled.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(settled[1]).toEqual(settled[0])
    await expect(refresh(1000)).resolves.toBeUndefined()
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('aborts a timed out network request and permits a fresh attempt', async () => {
    let signal: AbortSignal | null | undefined
    network
      .mockImplementationOnce((_input, init) => {
        signal = init?.signal
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
        })
      })
      .mockResolvedValue(new Response('{}'))
    const refresh = await loadRefresh()
    const result = Promise.allSettled([refresh(1000)])

    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(1000)

    expect((await result)[0]?.status).toBe('rejected')
    expect(signal?.aborted).toBe(true)
    await expect(refresh(1000)).resolves.toBeUndefined()
    expect(network).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels one caller without aborting the shared refresh', async () => {
    const response = deferred<Response>()
    network.mockReturnValue(response.promise)
    const refresh = await loadRefresh()
    const controller = new AbortController()
    const canceled = Promise.allSettled([refresh(1000, controller.signal)])
    const remaining = refresh(1000)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))

    controller.abort()
    expect((await canceled)[0]).toMatchObject({
      status: 'rejected',
      reason: { name: 'AbortError' },
    })
    expect(network.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)

    response.resolve(new Response('{}'))
    await expect(remaining).resolves.toBeUndefined()
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('refreshes without persistence when localStorage is unavailable', async () => {
    network.mockResolvedValue(new Response('{}'))
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Access denied', 'SecurityError')
      },
    })
    const refresh = await loadRefresh()

    await expect(refresh(1000)).resolves.toBeUndefined()
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('does not start refreshing for an already canceled caller', async () => {
    const refresh = await loadRefresh()
    const controller = new AbortController()
    controller.abort()

    await expect(refresh(1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(network).not.toHaveBeenCalled()
  })

  it.each([200, 500])('shares HTTP %s across documents queued on Web Locks', async (status) => {
    const locks = createLocks()
    vi.stubGlobal('navigator', { locks })
    const response = deferred<Response>()
    network.mockReturnValue(response.promise)
    const firstDocument = await loadRefresh()
    const first = Promise.allSettled([firstDocument(5000)])
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    const otherDocument = await loadRefresh()
    const other = Promise.allSettled([otherDocument(5000)])
    response.resolve(new Response('{}', { status }))

    const expectedStatus = status === 200 ? 'fulfilled' : 'rejected'
    expect((await first)[0]?.status).toBe(expectedStatus)
    expect((await other)[0]?.status).toBe(expectedStatus)
    expect(network).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares one replacement refresh when multiple documents take over an abandoned lock', async () => {
    vi.stubGlobal('navigator', { locks: createLocks() })
    localStorage.setItem(
      'console-session-refresh:https://example.com/console/api',
      JSON.stringify({
        id: 'closed-document',
        state: 'pending',
        expiresAt: Date.now() + 5000,
      }),
    )
    network.mockResolvedValue(new Response('{}'))
    const firstDocument = await loadRefresh()
    const secondDocument = await loadRefresh()

    await expect(Promise.all([firstDocument(5000), secondDocument(5000)])).resolves.toEqual([
      undefined,
      undefined,
    ])
    expect(network).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares a failed storage-coordinated refresh with another document', async () => {
    const response = deferred<Response>()
    network.mockReturnValue(response.promise)
    const firstDocument = await loadRefresh()
    const first = Promise.allSettled([firstDocument(5000)])
    const otherDocument = await loadRefresh()
    const other = Promise.allSettled([otherDocument(5000)])

    response.resolve(new Response('{}', { status: 500 }))
    await vi.advanceTimersByTimeAsync(1000)

    expect((await first)[0]?.status).toBe('rejected')
    expect((await other)[0]).toMatchObject({
      status: 'rejected',
      reason: { message: 'Session refresh failed (500)' },
    })
    expect(network).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { firstStatus: 200, nextStatus: 500, expected: 'fulfilled' },
    { firstStatus: 500, nextStatus: 200, expected: 'rejected' },
  ])(
    'keeps a delayed $firstStatus outcome when a later refresh returns $nextStatus',
    async ({ firstStatus, nextStatus, expected }) => {
      const firstResponse = deferred<Response>()
      network
        .mockReturnValueOnce(firstResponse.promise)
        .mockResolvedValue(new Response('{}', { status: nextStatus }))
      const owner = await loadRefresh()
      const first = Promise.allSettled([owner(5000)])
      const key = localStorage.key(0)
      if (!key) throw new Error('Expected a shared refresh attempt')
      const pending = localStorage.getItem(key)
      const otherDocument = await loadRefresh()
      const waiting = Promise.allSettled([otherDocument(5000)])

      firstResponse.resolve(new Response('{}', { status: firstStatus }))
      await first
      const completed = localStorage.getItem(key)
      await Promise.allSettled([owner(5000)])

      // A background document can poll the newest record before its queued storage events run.
      await vi.advanceTimersByTimeAsync(1000)
      globalThis.dispatchEvent(new StorageEvent('storage', { key, newValue: pending }))
      globalThis.dispatchEvent(new StorageEvent('storage', { key, newValue: completed }))

      expect((await waiting)[0]?.status).toBe(expected)
      expect(network).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('does not let a waiting document timeout release the active refresh', async () => {
    const response = deferred<Response>()
    network.mockReturnValue(response.promise)
    const firstDocument = await loadRefresh()
    const first = firstDocument(5000)
    const waitingDocument = await loadRefresh()
    const waiting = Promise.allSettled([waitingDocument(1000)])

    await vi.advanceTimersByTimeAsync(1000)
    expect((await waiting)[0]?.status).toBe('rejected')
    expect(network.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)

    const thirdDocument = await loadRefresh()
    const third = thirdDocument(5000)
    expect(network).toHaveBeenCalledTimes(1)
    response.resolve(new Response('{}'))
    await vi.advanceTimersByTimeAsync(1000)
    await expect(Promise.all([first, third])).resolves.toEqual([undefined, undefined])
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('does not let a late timed-out response overwrite the next attempt', async () => {
    const oldResponse = deferred<Response>()
    const newResponse = deferred<Response>()
    network.mockReturnValueOnce(oldResponse.promise).mockReturnValue(newResponse.promise)
    const firstDocument = await loadRefresh()
    const first = Promise.allSettled([firstDocument(1000)])
    await vi.advanceTimersByTimeAsync(1000)
    expect((await first)[0]?.status).toBe('rejected')

    const nextDocument = await loadRefresh()
    const next = nextDocument(5000)
    oldResponse.resolve(new Response('{}'))
    await vi.advanceTimersByTimeAsync(0)
    const waitingDocument = await loadRefresh()
    const waiting = waitingDocument(5000)
    expect(network).toHaveBeenCalledTimes(2)

    newResponse.resolve(new Response('{}'))
    await vi.advanceTimersByTimeAsync(1000)
    await expect(Promise.all([next, waiting])).resolves.toEqual([undefined, undefined])
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('uses storage coordination when the browser denies Web Locks access', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn().mockRejectedValue(new DOMException('Access denied', 'SecurityError')),
      },
    })
    network.mockResolvedValue(new Response('{}'))
    const refresh = await loadRefresh()

    await expect(refresh(1000)).resolves.toBeUndefined()
    expect(network).toHaveBeenCalledTimes(1)
  })
})
