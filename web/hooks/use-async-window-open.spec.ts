import { act, renderHook } from '@testing-library/react'
import { useAsyncWindowOpen } from './use-async-window-open'

const createMockWindow = (opener: string | null, close = vi.fn()) => {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  const popup = iframe.contentWindow!
  Object.defineProperty(popup, 'opener', { value: opener, writable: true, configurable: true })
  vi.spyOn(popup, 'close').mockImplementation(close)
  Object.defineProperty(popup, 'location', { value: { href: '' }, configurable: true })
  return popup
}

describe('useAsyncWindowOpen', () => {
  const originalOpen = window.open

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.querySelectorAll('iframe').forEach((iframe) => iframe.remove())
  })

  afterAll(() => {
    window.open = originalOpen
  })

  it('opens immediate url synchronously, clears opener, without calling async getter', async () => {
    const mockWindow = createMockWindow('should-clear')
    const openSpy = vi.fn(() => mockWindow)
    window.open = openSpy
    const getUrl = vi.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(getUrl, {
        immediateUrl: 'https://example.com',
        target: '_blank',
        features: undefined,
      })
    })

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    expect(getUrl).not.toHaveBeenCalled()
    expect(mockWindow.opener).toBeNull()
  })

  it('appends noopener,noreferrer when immediate open passes custom features', async () => {
    const mockWindow = createMockWindow('should-clear')
    const openSpy = vi.fn(() => mockWindow)
    window.open = openSpy
    const getUrl = vi.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(getUrl, {
        immediateUrl: 'https://example.com',
        target: '_blank',
        features: 'width=500',
      })
    })

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'width=500,noopener,noreferrer',
    )
    expect(getUrl).not.toHaveBeenCalled()
    expect(mockWindow.opener).toBeNull()
  })

  it('reports error when immediate window fails to open', async () => {
    const openSpy = vi.fn(() => null)
    window.open = openSpy
    const getUrl = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(getUrl, {
        immediateUrl: 'https://example.com',
        target: '_blank',
        onError,
      })
    })

    expect(onError).toHaveBeenCalled()
    const errArg = onError.mock.calls[0]![0] as Error
    expect(errArg.message).toBe('Failed to open new window')
    expect(getUrl).not.toHaveBeenCalled()
  })

  it('sets opener to null and redirects when async url resolves', async () => {
    const close = vi.fn()
    const mockWindow = createMockWindow('should-be-cleared', close)
    const openSpy = vi.fn(() => mockWindow)
    window.open = openSpy
    const { result } = renderHook(() => useAsyncWindowOpen())

    let resolveUrl!: (url: string) => void
    const url = new Promise<string>((resolve) => {
      resolveUrl = resolve
    })
    const pendingOpen = result.current(() => url)
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', undefined)
    expect(mockWindow.opener).toBeNull()
    expect(mockWindow.location.href).toBe('')
    await act(async () => {
      resolveUrl('https://example.com/path')
      await pendingOpen
    })

    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', undefined)
    expect(mockWindow.opener).toBeNull()
    expect(mockWindow.location.href).toBe('https://example.com/path')
    expect(close).not.toHaveBeenCalled()
  })

  it('closes placeholder and forwards error when async getter throws', async () => {
    const close = vi.fn()
    const mockWindow = createMockWindow(null, close)
    const openSpy = vi.fn(() => mockWindow)
    window.open = openSpy
    const onError = vi.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    const error = new Error('fetch failed')
    await act(async () => {
      await result.current(
        async () => {
          throw error
        },
        { onError },
      )
    })

    expect(close).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error)
    expect(mockWindow.location.href).toBe('')
  })

  it('preserves custom features as-is for async open', async () => {
    const close = vi.fn()
    const mockWindow = createMockWindow('should-be-cleared', close)
    const openSpy = vi.fn(() => mockWindow)
    window.open = openSpy
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(async () => 'https://example.com/path', {
        target: '_blank',
        features: 'width=500',
      })
    })

    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', 'width=500')
    expect(mockWindow.opener).toBeNull()
    expect(mockWindow.location.href).toBe('https://example.com/path')
    expect(close).not.toHaveBeenCalled()
  })

  it('closes placeholder and reports when no url is returned', async () => {
    const close = vi.fn()
    const mockWindow = createMockWindow(null, close)
    const openSpy = vi.fn(() => mockWindow)
    window.open = openSpy
    const onError = vi.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(async () => null, { onError })
    })

    expect(close).toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
    const errArg = onError.mock.calls[0]![0] as Error
    expect(errArg.message).toBe('No url resolved for new window')
  })

  it('reports failure when window.open returns null', async () => {
    const openSpy = vi.fn(() => null)
    window.open = openSpy
    const getUrl = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(getUrl, { onError })
    })

    expect(onError).toHaveBeenCalled()
    const errArg = onError.mock.calls[0]![0] as Error
    expect(errArg.message).toBe('Failed to open new window')
    expect(getUrl).not.toHaveBeenCalled()
  })
})
