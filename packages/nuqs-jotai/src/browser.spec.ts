import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createBrowserQueryAdapter } from './browser'

afterEach(() => vi.restoreAllMocks())

describe('browser URL adapter', () => {
  it('preserves unrelated parameters and hash, emits history changes and refreshes non-shallow writes', async () => {
    window.history.replaceState(null, '', '/documents?settings=profile#section')
    const refresh = vi.fn()
    const adapter = createBrowserQueryAdapter({
      initialUrl: new URL(window.location.href),
      refresh,
    })
    const listener = vi.fn()
    const unsubscribe = adapter.subscribe(listener)
    const url = adapter.read()
    url.searchParams.set('query', 'jotai')
    adapter.write(url, { history: 'push', shallow: false, scroll: false })
    expect(window.location.search).toBe('?settings=profile&query=jotai')
    expect(window.location.hash).toBe('#section')
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    expect(refresh.mock.calls[0]?.[0].href).toBe(url.href)
    window.history.replaceState(null, '', '/documents?query=external')
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(listener.mock.calls[2]?.[0].traversal).toBe(true)
    unsubscribe()
    window.history.replaceState(null, '', '/other')
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('does not request a route refresh for shallow updates', () => {
    const refresh = vi.fn()
    const adapter = createBrowserQueryAdapter({
      initialUrl: new URL(window.location.href),
      refresh,
    })
    adapter.write(new URL('/documents?query=local', window.location.href), {
      history: 'replace',
      shallow: true,
      scroll: false,
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})
