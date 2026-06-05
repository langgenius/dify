import {
  flushRegistrationSuccess,
  REGISTRATION_SUCCESS_STORAGE_KEY,
  rememberRegistrationSuccess,
} from '../registration-tracking'

const mockTrackEvent = vi.hoisted(() => vi.fn())

vi.mock('../utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

describe('registration tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  // Captures the registration event for a later flush instead of firing it right away.
  describe('rememberRegistrationSuccess', () => {
    it('should store the base event and not track immediately when there is no utm info', () => {
      rememberRegistrationSuccess({ method: 'email' })

      expect(JSON.parse(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)!)).toEqual({
        eventName: 'user_registration_success',
        properties: { method: 'email' },
      })
      expect(mockTrackEvent).not.toHaveBeenCalled()
    })

    it('should store the utm event and merge utm info into properties when utm info is present', () => {
      rememberRegistrationSuccess({
        method: 'oauth',
        utmInfo: { utm_source: 'linkedin', slug: 'agent-launch' },
      })

      expect(JSON.parse(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)!)).toEqual({
        eventName: 'user_registration_success_with_utm',
        properties: { method: 'oauth', utm_source: 'linkedin', slug: 'agent-launch' },
      })
    })

    it('should swallow errors when writing to sessionStorage fails', () => {
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: vi.fn(() => null),
          setItem: () => {
            throw new Error('quota exceeded')
          },
          removeItem: vi.fn(),
        },
      })

      try {
        expect(() => rememberRegistrationSuccess({ method: 'email' })).not.toThrow()
      }
      finally {
        vi.unstubAllGlobals()
      }
    })
  })

  // Replays the remembered event exactly once, after the user ID has been attached.
  describe('flushRegistrationSuccess', () => {
    it('should track the remembered event and clear it from storage', () => {
      rememberRegistrationSuccess({ method: 'email', utmInfo: { utm_source: 'blog' } })

      flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
        method: 'email',
        utm_source: 'blog',
      })
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('should do nothing when there is no pending event', () => {
      flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
    })

    it('should fire the event at most once across repeated flushes', () => {
      rememberRegistrationSuccess({ method: 'oauth' })

      flushRegistrationSuccess()
      flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    })

    it('should clear malformed pending data without tracking', () => {
      window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, '{not-json')

      flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('should clear the pending entry without tracking when it has no event name', () => {
      window.sessionStorage.setItem(
        REGISTRATION_SUCCESS_STORAGE_KEY,
        JSON.stringify({ properties: { method: 'email' } }),
      )

      flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('should stop without tracking when reading from sessionStorage throws', () => {
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: () => {
            throw new Error('read failed')
          },
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
      })

      try {
        expect(() => flushRegistrationSuccess()).not.toThrow()
        expect(mockTrackEvent).not.toHaveBeenCalled()
      }
      finally {
        vi.unstubAllGlobals()
      }
    })

    it('should still track when clearing the pending entry fails', () => {
      const pending = { eventName: 'user_registration_success', properties: { method: 'email' } }
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: () => JSON.stringify(pending),
          setItem: vi.fn(),
          removeItem: () => {
            throw new Error('remove failed')
          },
        },
      })

      try {
        flushRegistrationSuccess()

        expect(mockTrackEvent).toHaveBeenCalledWith('user_registration_success', { method: 'email' })
      }
      finally {
        vi.unstubAllGlobals()
      }
    })
  })

  // Both producers and the consumer must degrade gracefully when sessionStorage is
  // missing (SSR) or blocked (privacy mode / disabled storage).
  describe('when sessionStorage is unavailable', () => {
    it('should no-op without throwing when window is undefined', () => {
      vi.stubGlobal('window', undefined)

      try {
        expect(() => rememberRegistrationSuccess({ method: 'email' })).not.toThrow()
        expect(() => flushRegistrationSuccess()).not.toThrow()
        expect(mockTrackEvent).not.toHaveBeenCalled()
      }
      finally {
        vi.unstubAllGlobals()
      }
    })

    it('should no-op without throwing when accessing sessionStorage throws', () => {
      vi.stubGlobal('window', {
        get sessionStorage() {
          throw new Error('storage disabled')
        },
      })

      try {
        expect(() => rememberRegistrationSuccess({ method: 'oauth' })).not.toThrow()
        expect(() => flushRegistrationSuccess()).not.toThrow()
        expect(mockTrackEvent).not.toHaveBeenCalled()
      }
      finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
