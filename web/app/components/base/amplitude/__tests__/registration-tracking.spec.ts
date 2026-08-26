import {
  coordinateRegistrationConsent,
  flushRegistrationSuccess,
  REGISTRATION_SUCCESS_STORAGE_KEY,
  rememberRegistrationSuccess,
  subscribeRegistrationSuccess,
} from '../registration-tracking'

const mockTrackEvent = vi.hoisted(() => vi.fn())
const mockAmplitudeInitialized = vi.hoisted(() => ({ value: true }))
const mockConsent = vi.hoisted(() => ({
  value: 'granted' as 'unknown' | 'denied' | 'granted',
}))

vi.mock('../utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('../init', () => ({
  getIsAmplitudeInitialized: () => mockAmplitudeInitialized.value,
}))

vi.mock('@/app/components/base/analytics-consent/consent-store', () => ({
  getAnalyticsConsent: () => mockConsent.value,
}))

const successResult = () => ({
  promise: Promise.resolve({ code: 200 }),
})

const getStoredMarker = () =>
  JSON.parse(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)!)

describe('registration tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.sessionStorage.clear()
    mockConsent.value = 'granted'
    mockAmplitudeInitialized.value = true
    mockTrackEvent.mockImplementation(successResult)
    coordinateRegistrationConsent('denied')
    mockConsent.value = 'granted'
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  describe('rememberRegistrationSuccess', () => {
    it('stores a versioned marker with stable delivery metadata and allowlisted attribution', () => {
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))

      rememberRegistrationSuccess({
        method: 'email_code',
        utmInfo: {
          utm_source: 'linkedin',
          utm_medium: 'social',
          utm_campaign: 'launch',
          utm_content: 'hero',
          utm_term: 'agents',
          slug: 'agent-launch',
          unexpected: 'discard-me',
          nested: { unsafe: true },
        },
      })

      const occurredAt = Date.now()
      expect(getStoredMarker()).toEqual({
        version: 2,
        registrationId: '11111111-1111-4111-8111-111111111111',
        occurredAt,
        expiresAt: occurredAt + 24 * 60 * 60 * 1000,
        eventName: 'user_registration_success_with_utm',
        method: 'email_code',
        attribution: {
          utm_source: 'linkedin',
          utm_medium: 'social',
          utm_campaign: 'launch',
          utm_content: 'hero',
          utm_term: 'agents',
          slug: 'agent-launch',
        },
      })
      expect(mockTrackEvent).not.toHaveBeenCalled()
    })

    it('keeps one non-oauth intent only in memory while consent is unknown and promotes it on grant', () => {
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))
      mockConsent.value = 'unknown'

      rememberRegistrationSuccess({ method: 'email', utmInfo: { utm_source: 'first' } })
      rememberRegistrationSuccess({
        method: 'workspace_invite',
        utmInfo: { utm_source: 'latest' },
      })

      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()

      mockConsent.value = 'granted'
      coordinateRegistrationConsent('granted')

      expect(getStoredMarker()).toMatchObject({
        version: 2,
        method: 'workspace_invite',
        attribution: { utm_source: 'latest' },
      })
    })

    it('discards an unknown-consent intent on denial or after thirty minutes', () => {
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))
      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'email' })

      coordinateRegistrationConsent('denied')
      mockConsent.value = 'granted'
      coordinateRegistrationConsent('granted')
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()

      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'email' })
      vi.setSystemTime(new Date('2026-08-26T09:30:00.001Z'))
      mockConsent.value = 'granted'
      coordinateRegistrationConsent('granted')
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('discards a stored marker when consent changes to denied', () => {
      rememberRegistrationSuccess({ method: 'email' })

      coordinateRegistrationConsent('denied')

      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('does not put an oauth intent in memory before consent', () => {
      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'oauth' })

      mockConsent.value = 'granted'
      coordinateRegistrationConsent('granted')

      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('notifies consumers only after a marker is stored', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeRegistrationSuccess(listener)

      rememberRegistrationSuccess({ method: 'email' })

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('swallows sessionStorage write errors without notifying consumers', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeRegistrationSuccess(listener)
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: vi.fn(() => null),
          setItem: () => {
            throw new Error('quota exceeded')
          },
          removeItem: vi.fn(),
        },
      })

      expect(() => rememberRegistrationSuccess({ method: 'email' })).not.toThrow()
      expect(listener).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('flushRegistrationSuccess', () => {
    it('waits for a successful SDK result before acknowledging the marker', async () => {
      let resolveTrack!: (result: { code: number }) => void
      mockTrackEvent.mockReturnValue({
        promise: new Promise((resolve) => {
          resolveTrack = resolve
        }),
      })
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))
      rememberRegistrationSuccess({ method: 'oauth', utmInfo: { utm_source: 'blog' } })

      const flushPromise = flushRegistrationSuccess()

      expect(getStoredMarker()).toBeTruthy()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'user_registration_success_with_utm',
        {
          method: 'oauth',
          utm_source: 'blog',
          registration_id: '11111111-1111-4111-8111-111111111111',
          event_version: 2,
          tracking_contract_version: 'consent_wait_v2',
        },
        {
          insert_id: '11111111-1111-4111-8111-111111111111',
          time: Date.now(),
        },
      )

      resolveTrack({ code: 200 })
      await flushPromise
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it.each([
      ['unknown consent', () => (mockConsent.value = 'unknown')],
      ['uninitialized Amplitude', () => (mockAmplitudeInitialized.value = false)],
    ])('defers without deleting for %s', async (_label, makeIneligible) => {
      rememberRegistrationSuccess({ method: 'email' })
      makeIneligible()

      await flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(getStoredMarker()).toBeTruthy()
    })

    it('discards a pending marker when consent is denied', async () => {
      rememberRegistrationSuccess({ method: 'oauth' })
      mockConsent.value = 'denied'

      await flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('retains the marker on SDK rejection or a non-success result and reuses its id and time', async () => {
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))
      rememberRegistrationSuccess({ method: 'email' })
      const marker = getStoredMarker()
      mockTrackEvent
        .mockReturnValueOnce({ promise: Promise.reject(new Error('network failed')) })
        .mockReturnValueOnce({ promise: Promise.resolve({ code: 500 }) })
        .mockImplementation(successResult)

      await flushRegistrationSuccess()
      await flushRegistrationSuccess()

      expect(getStoredMarker()).toEqual(marker)
      expect(mockTrackEvent.mock.calls[0]?.[2]).toEqual({
        insert_id: marker.registrationId,
        time: marker.occurredAt,
      })
      expect(mockTrackEvent.mock.calls[1]?.[2]).toEqual({
        insert_id: marker.registrationId,
        time: marker.occurredAt,
      })
    })

    it('coalesces concurrent flushes into one SDK send', async () => {
      let resolveTrack!: (result: { code: number }) => void
      mockTrackEvent.mockReturnValue({
        promise: new Promise((resolve) => {
          resolveTrack = resolve
        }),
      })
      rememberRegistrationSuccess({ method: 'email' })

      const first = flushRegistrationSuccess()
      const second = flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
      resolveTrack({ code: 200 })
      await Promise.all([first, second])
    })

    it('discards expired and malformed markers without tracking', async () => {
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))
      rememberRegistrationSuccess({ method: 'email' })
      vi.setSystemTime(new Date('2026-08-27T09:00:00.000Z'))

      await flushRegistrationSuccess()
      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()

      const malformedMarkers = [
        '{not-json',
        JSON.stringify({ version: 1, eventName: 'user_registration_success' }),
        JSON.stringify({
          version: 2,
          registrationId: 'id',
          occurredAt: Date.now(),
          expiresAt: Date.now() + 1000,
          eventName: 'arbitrary_event',
          method: 'email',
          attribution: {},
        }),
      ]

      for (const raw of malformedMarkers) {
        window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, raw)
        await flushRegistrationSuccess()
        expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      }
      expect(mockTrackEvent).not.toHaveBeenCalled()
    })

    it('handles storage read errors without throwing', async () => {
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: () => {
            throw new Error('read failed')
          },
          setItem: vi.fn(),
          removeItem: () => {
            throw new Error('remove failed')
          },
        },
      })

      await expect(flushRegistrationSuccess()).resolves.toBeUndefined()
      expect(mockTrackEvent).not.toHaveBeenCalled()
    })

    it('retains the same marker when acknowledgement removal fails', async () => {
      rememberRegistrationSuccess({ method: 'email' })
      const raw = window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
      const removeItem = vi.fn(() => {
        throw new Error('remove failed')
      })
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: () => raw,
          setItem: vi.fn(),
          removeItem,
        },
      })

      await expect(flushRegistrationSuccess()).resolves.toBeUndefined()
      await expect(flushRegistrationSuccess()).resolves.toBeUndefined()

      expect(mockTrackEvent).toHaveBeenCalledTimes(2)
      expect(mockTrackEvent.mock.calls[0]?.[2]).toEqual(mockTrackEvent.mock.calls[1]?.[2])
      expect(removeItem).toHaveBeenCalledTimes(2)
    })

    it('no-ops when sessionStorage access is blocked', async () => {
      vi.stubGlobal('window', {
        get sessionStorage() {
          throw new Error('storage disabled')
        },
      })

      expect(() => rememberRegistrationSuccess({ method: 'email' })).not.toThrow()
      await expect(flushRegistrationSuccess()).resolves.toBeUndefined()
      expect(mockTrackEvent).not.toHaveBeenCalled()
    })
  })
})
