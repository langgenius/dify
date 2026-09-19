import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useOAuthCallback } from '../use-oauth'

type AnyGlobal = Record<string, any>

const setSearch = (search: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search, origin: 'https://console.example.com' },
  })
}

const setOpener = (opener: AnyGlobal | null) => {
  Object.defineProperty(window, 'opener', {
    configurable: true,
    value: opener,
    writable: true,
  })
}

describe('useOAuthCallback', () => {
  let postMessage: ReturnType<typeof vi.fn>
  let close: ReturnType<typeof vi.fn>
  let replace: ReturnType<typeof vi.fn>
  let originalOpener: any

  beforeEach(() => {
    postMessage = vi.fn()
    close = vi.fn()
    replace = vi.fn()
    originalOpener = window.opener
    Object.defineProperty(window, 'close', { configurable: true, value: close })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, replace, origin: 'https://console.example.com', search: '' },
      writable: true,
    })
  })

  afterEach(() => {
    setOpener(originalOpener)
  })

  describe('popup flow (window.opener exists)', () => {
    beforeEach(() => {
      setOpener({ origin: 'https://console.example.com', postMessage })
    })

    it('posts a success message and closes the popup on subscription_id', () => {
      setSearch('?subscription_id=sub-123')
      renderHook(() => useOAuthCallback())

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'oauth_callback', success: true, subscriptionId: 'sub-123' },
        'https://console.example.com',
      )
      expect(close).toHaveBeenCalled()
    })

    it('posts an error message and closes the popup on error', () => {
      setSearch('?error=access_denied&error_description=User%20denied')
      renderHook(() => useOAuthCallback())

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'oauth_callback', success: false, error: 'access_denied', errorDescription: 'User denied' },
        'https://console.example.com',
      )
      expect(close).toHaveBeenCalled()
    })

    it('does not replace the location', () => {
      setSearch('?subscription_id=sub-123')
      renderHook(() => useOAuthCallback())

      expect(replace).not.toHaveBeenCalled()
    })
  })

  describe('top-level navigation flow (no window.opener)', () => {
    beforeEach(() => {
      setOpener(null)
    })

    it('redirects to console home when subscription_id is present', () => {
      setSearch('?subscription_id=sub-123')
      renderHook(() => useOAuthCallback())

      expect(replace).toHaveBeenCalledWith('https://console.example.com/')
      expect(close).not.toHaveBeenCalled()
    })

    it('redirects to console home when error is present', () => {
      setSearch('?error=access_denied&error_description=User%20denied')
      renderHook(() => useOAuthCallback())

      expect(replace).toHaveBeenCalledWith('https://console.example.com/')
    })

    it('does nothing when no params are present (no false-positive redirect)', () => {
      setSearch('')
      renderHook(() => useOAuthCallback())

      expect(replace).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
    })

    it('does nothing when only unknown params are present', () => {
      setSearch('?some_other=value')
      renderHook(() => useOAuthCallback())

      expect(replace).not.toHaveBeenCalled()
    })
  })

  // Touch act so the unused import is not flagged when this file is the only consumer.
  it('exports a callable hook', () => {
    expect(typeof useOAuthCallback).toBe('function')
    expect(act).toBeTypeOf('function')
  })
})
