import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOAuthCallback } from '../use-oauth'

const originalOpener = window.opener
const originalClose = window.close

const setOpener = (opener: Window | null) => {
  Object.defineProperty(window, 'opener', { configurable: true, writable: true, value: opener })
}

describe('useOAuthCallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setOpener(originalOpener)
    window.close = originalClose
  })

  it('posts a success message and closes the popup when window.opener is present and a subscription_id is in the query', () => {
    const postMessage = vi.fn()
    setOpener({ origin: 'https://console.example.test', postMessage } as unknown as Window)
    const close = vi.fn()
    window.close = close
    window.history.replaceState({}, '', '/oauth-callback?subscription_id=sub-123')

    const { result } = renderHook(() => useOAuthCallback())

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'oauth_callback', success: true, subscriptionId: 'sub-123' },
      'https://console.example.test',
    )
    expect(close).toHaveBeenCalledTimes(1)
    expect(result.current.hasOpener).toBe(true)
    expect(result.current.finished).toBe(true)
  })

  it('posts an error message and closes the popup when window.opener is present and an error is in the query', () => {
    const postMessage = vi.fn()
    setOpener({ origin: 'https://console.example.test', postMessage } as unknown as Window)
    const close = vi.fn()
    window.close = close
    window.history.replaceState(
      {},
      '',
      '/oauth-callback?error=access_denied&error_description=User%20denied%20access',
    )

    renderHook(() => useOAuthCallback())

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'oauth_callback',
        success: false,
        error: 'access_denied',
        errorDescription: 'User denied access',
      },
      'https://console.example.test',
    )
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('falls back to targetOrigin "*" when window.opener has no origin (e.g. file:// popup)', () => {
    const postMessage = vi.fn()
    setOpener({ postMessage } as unknown as Window)
    const close = vi.fn()
    window.close = close
    window.history.replaceState({}, '', '/oauth-callback?subscription_id=sub-1')

    renderHook(() => useOAuthCallback())

    expect(postMessage).toHaveBeenCalledWith(expect.any(Object), '*')
  })

  it('exposes success state without posting a message when window.opener is missing (new-tab case) (#39752)', () => {
    setOpener(null)
    const close = vi.fn()
    window.close = close
    window.history.replaceState({}, '', '/oauth-callback?subscription_id=sub-tab-1')

    const { result } = renderHook(() => useOAuthCallback())

    // No opener, so we must NOT try to close (would close the only tab).
    expect(close).not.toHaveBeenCalled()
    // The page needs the state to render a meaningful message instead of an empty <div />.
    expect(result.current.hasOpener).toBe(false)
    expect(result.current.finished).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.errorDescription).toBeNull()
  })

  it('exposes the provider error in state when window.opener is missing (#39752)', () => {
    setOpener(null)
    const close = vi.fn()
    window.close = close
    window.history.replaceState(
      {},
      '',
      '/oauth-callback?error=access_denied&error_description=Please%20re-authorize',
    )

    const { result } = renderHook(() => useOAuthCallback())

    expect(close).not.toHaveBeenCalled()
    expect(result.current.hasOpener).toBe(false)
    expect(result.current.finished).toBe(true)
    expect(result.current.error).toBe('access_denied')
    expect(result.current.errorDescription).toBe('Please re-authorize')
  })

  it('initial state mirrors the current window.opener so the first paint can decide which UI to render', () => {
    setOpener({ origin: 'https://console.example.test', postMessage: vi.fn() } as unknown as Window)
    const { result } = renderHook(() => useOAuthCallback())
    expect(result.current.hasOpener).toBe(true)

    setOpener(null)
    const { result: result2 } = renderHook(() => useOAuthCallback())
    expect(result2.current.hasOpener).toBe(false)
  })
})
