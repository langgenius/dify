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
  })
})
