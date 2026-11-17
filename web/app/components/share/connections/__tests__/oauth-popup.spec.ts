import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { authorizeConnection } from '../oauth-popup'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('authorizeConnection', () => {
  let abortController: AbortController
  let child: {
    closed: boolean
    close: ReturnType<typeof vi.fn>
    location: { replace: ReturnType<typeof vi.fn> }
  }
  let popup: Window

  const run = (
    getAuthorizationUrl: Parameters<typeof authorizeConnection>[0],
    options: Parameters<typeof authorizeConnection>[1] = {},
  ) => {
    const operation = authorizeConnection(getAuthorizationUrl, {
      signal: abortController.signal,
      ...options,
    })
    // An interrupted test still aborts its pending operation during cleanup.
    void operation.catch(() => {})
    return operation
  }
  const message = (
    data: unknown,
    { source = popup, origin = window.location.origin }: { source?: Window; origin?: string } = {},
  ) => {
    window.dispatchEvent(new MessageEvent('message', { data, source, origin }))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    abortController = new AbortController()
    child = {
      closed: false,
      close: vi.fn(() => {
        child.closed = true
      }),
      location: { replace: vi.fn() },
    }
    popup = child as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
  })

  afterEach(() => {
    abortController.abort()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens synchronously before requesting a URL and accepts the created ID only once', async () => {
    const authorization = deferred<{ authorization_url: string }>()
    const getAuthorizationUrl = vi.fn(() => {
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', expect.any(String))
      return authorization.promise
    })
    const operation = run(getAuthorizationUrl)

    expect(getAuthorizationUrl).toHaveBeenCalledOnce()
    expect(child.location.replace).not.toHaveBeenCalled()
    authorization.resolve({ authorization_url: 'https://provider.example/authorize?state=opaque' })
    await authorization.promise
    expect(child.location.replace).toHaveBeenCalledExactlyOnceWith(
      'https://provider.example/authorize?state=opaque',
    )

    message({ type: 'oauth_callback', success: true, connectionId: 'created-connection' })
    message({ type: 'oauth_callback', success: true, connectionId: 'different-connection' })

    await expect(operation).resolves.toBe('created-connection')
    await vi.advanceTimersByTimeAsync(1000)
    expect(child.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a blocked popup without creating an authorization request', async () => {
    vi.mocked(window.open).mockReturnValue(null)
    const getAuthorizationUrl = vi.fn()

    await expect(run(getAuthorizationUrl)).rejects.toThrow(
      'The authorization window could not be opened.',
    )

    expect(getAuthorizationUrl).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes the blank popup and propagates a failed authorization request', async () => {
    const authorization = deferred<{ authorization_url: string }>()
    const operation = run(() => authorization.promise)
    const error = new Error('Authorization endpoint unavailable.')
    authorization.reject(error)

    await expect(operation).rejects.toBe(error)

    expect(child.close).toHaveBeenCalledOnce()
    expect(child.location.replace).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes the popup when the endpoint returns a non-HTTP authorization URL', async () => {
    await expect(run(async () => ({ authorization_url: 'javascript:alert(1)' }))).rejects.toThrow(
      'Invalid authorization URL.',
    )

    expect(child.close).toHaveBeenCalledOnce()
    expect(child.location.replace).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores unrelated windows, origins and callbacks without a successful connection ID', async () => {
    const operation = run(async () => ({ authorization_url: 'https://provider.example/authorize' }))
    message(
      { type: 'oauth_callback', success: true, connectionId: 'foreign-window' },
      { source: window },
    )
    message(
      { type: 'oauth_callback', success: true, connectionId: 'foreign-origin' },
      { origin: 'https://untrusted.example' },
    )
    message({ type: 'other_callback', success: true, connectionId: 'wrong-message' })
    message({ type: 'oauth_callback' })
    message({ type: 'oauth_callback', success: true, connectionId: '   ' })
    expect(child.close).not.toHaveBeenCalled()

    child.closed = true
    await vi.advanceTimersByTimeAsync(1000)

    await expect(operation).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts an explicitly configured callback origin while rejecting the default origin', async () => {
    const callbackOrigin = 'https://apps.example'
    const operation = run(
      async () => ({ authorization_url: 'https://provider.example/authorize' }),
      { callbackOrigin },
    )
    message({ type: 'oauth_callback', success: true, connectionId: 'wrong-origin' })
    expect(child.close).not.toHaveBeenCalled()

    message(
      { type: 'oauth_callback', success: true, connectionId: 'created-connection' },
      { origin: callbackOrigin },
    )

    await expect(operation).resolves.toBe('created-connection')
    expect(child.close).toHaveBeenCalledOnce()
  })

  it('rejects an explicit failure from the expected popup and removes its listeners', async () => {
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const operation = run(async () => ({ authorization_url: 'https://provider.example/authorize' }))

    message({
      type: 'oauth_callback',
      success: false,
      error: 'access_denied',
      errorDescription: 'Authorization declined.',
    })

    await expect(operation).rejects.toThrow('Authorization declined.')
    expect(removeListener).toHaveBeenCalledWith('message', expect.any(Function))
    expect(child.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('treats closing a pending popup as cancellation and never navigates it after the URL arrives', async () => {
    const authorization = deferred<{ authorization_url: string }>()
    const operation = run(() => authorization.promise)
    child.closed = true

    await vi.advanceTimersByTimeAsync(1000)
    await expect(operation).resolves.toBeNull()
    authorization.resolve({ authorization_url: 'https://provider.example/authorize' })
    await authorization.promise

    expect(child.location.replace).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a pending operation, closes the popup and ignores a late authorization URL', async () => {
    const authorization = deferred<{ authorization_url: string }>()
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const operation = run(() => authorization.promise)

    abortController.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    authorization.resolve({ authorization_url: 'https://provider.example/authorize' })
    await authorization.promise
    expect(child.location.replace).not.toHaveBeenCalled()
    expect(child.close).toHaveBeenCalledOnce()
    expect(removeListener).toHaveBeenCalledWith('message', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not open a window or request a URL for an already aborted operation', async () => {
    abortController.abort()
    const getAuthorizationUrl = vi.fn()

    await expect(run(getAuthorizationUrl)).rejects.toMatchObject({ name: 'AbortError' })

    expect(window.open).not.toHaveBeenCalled()
    expect(getAuthorizationUrl).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
