import { act, renderHook } from '@testing-library/react'
import {
  buildOAuthCallbackMessage,
  notifyOAuthBroadcast,
  notifyOAuthCallback,
  notifyOAuthOpener,
  OAUTH_CALLBACK_MESSAGE_TYPE,
  openOAuthPopup,
  parseOAuthCallbackParams,
  useOAuthCallback,
} from './use-oauth'

describe('parseOAuthCallbackParams', () => {
  it('returns success when subscription_id is present', () => {
    expect(parseOAuthCallbackParams('?subscription_id=sub-123')).toEqual({
      success: true,
      subscriptionId: 'sub-123',
      error: null,
      errorDescription: null,
    })
  })

  it('returns error when error query param is present', () => {
    expect(
      parseOAuthCallbackParams('?error=access_denied&error_description=User%20denied'),
    ).toEqual({
      success: false,
      subscriptionId: null,
      error: 'access_denied',
      errorDescription: 'User denied',
    })
  })

  it('returns success when no params are present', () => {
    expect(parseOAuthCallbackParams('')).toEqual({
      success: true,
      subscriptionId: null,
      error: null,
      errorDescription: null,
    })
  })
})

describe('buildOAuthCallbackMessage', () => {
  it('builds subscription success payload', () => {
    expect(buildOAuthCallbackMessage('?subscription_id=sub-123')).toEqual({
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      subscriptionId: 'sub-123',
    })
  })

  it('builds error payload', () => {
    expect(buildOAuthCallbackMessage('?error=access_denied&error_description=Denied')).toEqual({
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
      success: false,
      error: 'access_denied',
      errorDescription: 'Denied',
    })
  })

  it('builds default success payload', () => {
    expect(buildOAuthCallbackMessage('')).toEqual({
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
    })
  })
})

describe('notifyOAuthOpener', () => {
  const originalOpener = window.opener

  afterEach(() => {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: originalOpener,
    })
  })

  it('posts message to opener when available', () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { origin: 'https://console.example.com', postMessage },
    })

    const message = buildOAuthCallbackMessage('')
    const notified = notifyOAuthOpener(message)

    expect(notified).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(message, 'https://console.example.com')
  })

  it('returns false when opener is missing', () => {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: null,
    })

    expect(notifyOAuthOpener(buildOAuthCallbackMessage(''))).toBe(false)
  })
})

describe('notifyOAuthBroadcast', () => {
  it('posts message through BroadcastChannel', () => {
    const postMessage = vi.fn()
    const close = vi.fn()
    class BroadcastChannelMock {
      name: string

      constructor(name: string) {
        this.name = name
      }

      postMessage = postMessage
      close = close
    }
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock)

    const message = buildOAuthCallbackMessage('')
    notifyOAuthBroadcast(message)

    expect(postMessage).toHaveBeenCalledWith(message)
    expect(close).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

describe('notifyOAuthCallback', () => {
  const originalOpener = window.opener

  afterEach(() => {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: originalOpener,
    })
    vi.unstubAllGlobals()
  })

  it('notifies opener and broadcast channel', () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { origin: 'https://console.example.com', postMessage },
    })

    const broadcastPostMessage = vi.fn()
    const broadcastClose = vi.fn()
    class BroadcastChannelMock {
      name: string

      constructor(name: string) {
        this.name = name
      }

      postMessage = broadcastPostMessage
      close = broadcastClose
    }
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock)

    const message = buildOAuthCallbackMessage('?subscription_id=sub-123')
    notifyOAuthCallback(message)

    expect(postMessage).toHaveBeenCalledWith(message, 'https://console.example.com')
    expect(broadcastPostMessage).toHaveBeenCalledWith(message)
    expect(broadcastClose).toHaveBeenCalled()
  })
})

describe('useOAuthCallback', () => {
  const originalClose = window.close
  const originalLocation = window.location

  beforeEach(() => {
    window.close = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { search: '' },
    })
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: null,
    })
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage = vi.fn()
        close = vi.fn()
      },
    )
  })

  afterEach(() => {
    window.close = originalClose
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    vi.unstubAllGlobals()
  })

  it('notifies parent, sets success status, and closes window', () => {
    const { result } = renderHook(() => useOAuthCallback())

    expect(result.current.status).toBe('success')
    expect(result.current.errorDescription).toBeNull()
    expect(window.close).toHaveBeenCalled()
  })

  it('sets error status when callback includes error params', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { search: '?error=access_denied&error_description=Denied' },
    })

    const { result } = renderHook(() => useOAuthCallback())

    expect(result.current.status).toBe('error')
    expect(result.current.errorDescription).toBe('Denied')
    expect(window.close).toHaveBeenCalled()
  })
})

describe('openOAuthPopup', () => {
  const originalOpen = window.open

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    window.open = originalOpen
    vi.unstubAllGlobals()
  })

  it('invokes callback from window message event', () => {
    const callback = vi.fn()
    const popup = { closed: false }
    window.open = vi.fn(() => popup as Window)

    openOAuthPopup('https://oauth.example.com/authorize', callback)

    const message = buildOAuthCallbackMessage('')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: message }))
    })

    expect(callback).toHaveBeenCalledWith(message)
  })

  it('invokes callback from BroadcastChannel when opener is unavailable', () => {
    const callback = vi.fn()
    const popup = { closed: false }
    window.open = vi.fn(() => popup as Window)

    let channelHandler: ((event: MessageEvent) => void) | undefined
    class BroadcastChannelMock {
      private messageHandler?: (event: MessageEvent) => void

      set onmessage(handler: (event: MessageEvent) => void) {
        this.messageHandler = handler
        channelHandler = handler
      }

      get onmessage() {
        return this.messageHandler ?? (() => {})
      }

      close = vi.fn()
    }
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock)

    openOAuthPopup('https://oauth.example.com/authorize', callback)

    const message = buildOAuthCallbackMessage('')
    act(() => {
      channelHandler?.(new MessageEvent('message', { data: message }))
    })

    expect(callback).toHaveBeenCalledWith(message)
  })

  it('deduplicates callback when both message and broadcast fire', () => {
    const callback = vi.fn()
    const popup = { closed: false }
    window.open = vi.fn(() => popup as Window)

    let channelHandler: ((event: MessageEvent) => void) | undefined
    class BroadcastChannelMock {
      private messageHandler?: (event: MessageEvent) => void

      set onmessage(handler: (event: MessageEvent) => void) {
        this.messageHandler = handler
        channelHandler = handler
      }

      get onmessage() {
        return this.messageHandler ?? (() => {})
      }

      close = vi.fn()
    }
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock)

    openOAuthPopup('https://oauth.example.com/authorize', callback)

    const message = buildOAuthCallbackMessage('')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: message }))
      channelHandler?.(new MessageEvent('message', { data: message }))
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('invokes callback when popup is closed without message', () => {
    const callback = vi.fn()
    const popup = { closed: false }
    window.open = vi.fn(() => popup as Window)

    openOAuthPopup('https://oauth.example.com/authorize', callback)

    popup.closed = true
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(callback).toHaveBeenCalledWith(undefined)
  })
})
