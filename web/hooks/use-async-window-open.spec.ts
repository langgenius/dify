import { act, renderHook } from '@testing-library/react'
import { useAsyncWindowOpen } from './use-async-window-open'

describe('useAsyncWindowOpen', () => {
  const originalOpen = window.open

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    window.open = originalOpen
  })

  it('opens immediate url synchronously without calling async getter', async () => {
    const openSpy = jest.fn()
    window.open = openSpy
    const getUrl = jest.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(getUrl, {
        immediateUrl: 'https://example.com',
        target: '_blank',
        features: 'noopener,noreferrer',
      })
    })

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    expect(getUrl).not.toHaveBeenCalled()
  })

  it('sets opener to null and redirects when async url resolves', async () => {
    const close = jest.fn()
    const mockWindow: any = {
      location: { href: '' },
      close,
      opener: 'should-be-cleared',
    }
    const openSpy = jest.fn(() => mockWindow)
    window.open = openSpy
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(async () => 'https://example.com/path')
    })

    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', undefined)
    expect(mockWindow.opener).toBeNull()
    expect(mockWindow.location.href).toBe('https://example.com/path')
    expect(close).not.toHaveBeenCalled()
  })

  it('closes placeholder and forwards error when async getter throws', async () => {
    const close = jest.fn()
    const mockWindow: any = {
      location: { href: '' },
      close,
      opener: null,
    }
    const openSpy = jest.fn(() => mockWindow)
    window.open = openSpy
    const onError = jest.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    const error = new Error('fetch failed')
    await act(async () => {
      await result.current(async () => {
        throw error
      }, { onError })
    })

    expect(close).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error)
    expect(mockWindow.location.href).toBe('')
  })

  it('closes placeholder and reports when no url is returned', async () => {
    const close = jest.fn()
    const mockWindow: any = {
      location: { href: '' },
      close,
      opener: null,
    }
    const openSpy = jest.fn(() => mockWindow)
    window.open = openSpy
    const onError = jest.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(async () => null, { onError })
    })

    expect(close).toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
    const errArg = onError.mock.calls[0][0] as Error
    expect(errArg.message).toBe('No url resolved for new window')
  })

  it('reports failure when window.open returns null', async () => {
    const openSpy = jest.fn(() => null)
    window.open = openSpy
    const getUrl = jest.fn()
    const onError = jest.fn()
    const { result } = renderHook(() => useAsyncWindowOpen())

    await act(async () => {
      await result.current(getUrl, { onError })
    })

    expect(onError).toHaveBeenCalled()
    const errArg = onError.mock.calls[0][0] as Error
    expect(errArg.message).toBe('Failed to open new window')
    expect(getUrl).not.toHaveBeenCalled()
  })
})
