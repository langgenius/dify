import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { MOBILE_MEDIA_QUERY, useIsMobile, useMediaQuery } from './use-media-query'

type Listener = (event: MediaQueryListEvent) => void

const createMatchMedia = (initialMatches: Record<string, boolean>) => {
  const matches = { ...initialMatches }
  const listeners = new Map<string, Set<Listener>>()

  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches[query] ?? false
    },
    media: query,
    addEventListener: (_type: 'change', listener: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(listener)
    },
    removeEventListener: (_type: 'change', listener: Listener) => {
      listeners.get(query)?.delete(listener)
    },
  }))

  const setMatches = (query: string, value: boolean) => {
    matches[query] = value
    act(() => {
      listeners
        .get(query)
        ?.forEach((listener) => listener({ matches: value } as MediaQueryListEvent))
    })
  }

  return { matchMedia, setMatches, listeners }
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should follow the media query change event', () => {
    const { matchMedia, setMatches } = createMatchMedia({ [MOBILE_MEDIA_QUERY]: false })
    vi.spyOn(window, 'matchMedia').mockImplementation(
      matchMedia as unknown as typeof window.matchMedia,
    )

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    setMatches(MOBILE_MEDIA_QUERY, true)
    expect(result.current).toBe(true)

    setMatches(MOBILE_MEDIA_QUERY, false)
    expect(result.current).toBe(false)
  })

  it('should not listen to window resize', () => {
    const { matchMedia } = createMatchMedia({ [MOBILE_MEDIA_QUERY]: false })
    vi.spyOn(window, 'matchMedia').mockImplementation(
      matchMedia as unknown as typeof window.matchMedia,
    )
    const addEventListener = vi.spyOn(window, 'addEventListener')

    renderHook(() => useIsMobile())

    expect(addEventListener).not.toHaveBeenCalledWith('resize', expect.anything())
  })

  it('should resubscribe when the query changes and clean up on unmount', () => {
    const { matchMedia, listeners } = createMatchMedia({ a: true, b: false })
    vi.spyOn(window, 'matchMedia').mockImplementation(
      matchMedia as unknown as typeof window.matchMedia,
    )

    const { result, rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: 'a' },
    })
    expect(result.current).toBe(true)

    rerender({ query: 'b' })
    expect(result.current).toBe(false)
    expect(listeners.get('a')?.size).toBe(0)
    expect(listeners.get('b')?.size).toBe(1)

    unmount()
    expect(listeners.get('b')?.size).toBe(0)
  })

  it('should hydrate server markup without a recoverable error and then read the viewport', async () => {
    const ResponsiveContent = () => {
      const isMobile = useIsMobile()
      return createElement('span', null, isMobile ? 'mobile' : 'desktop')
    }
    const container = document.createElement('div')
    container.innerHTML = renderToString(createElement(ResponsiveContent))
    expect(container).toHaveTextContent('desktop')

    const { matchMedia } = createMatchMedia({ [MOBILE_MEDIA_QUERY]: true })
    vi.spyOn(window, 'matchMedia').mockImplementation(
      matchMedia as unknown as typeof window.matchMedia,
    )
    const onRecoverableError = vi.fn()

    const root = hydrateRoot(container, createElement(ResponsiveContent), { onRecoverableError })
    try {
      await act(async () => {})
      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container).toHaveTextContent('mobile')
    } finally {
      act(() => root.unmount())
    }
  })
})
