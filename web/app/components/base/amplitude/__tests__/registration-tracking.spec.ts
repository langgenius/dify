import {
  discardRegistrationSessionState,
  REGISTRATION_SUCCESS_STORAGE_KEY,
} from '../registration-session-state'
import {
  coordinateRegistrationConsent,
  flushRegistrationSuccess,
  rememberRegistrationSuccess,
  subscribeRegistrationSuccess,
} from '../registration-tracking'

const mockTrackEvent = vi.hoisted(() => vi.fn())
const mockAmplitudeInitialized = vi.hoisted(() => ({ value: true }))
const mockConsent = vi.hoisted(() => ({
  value: 'granted' as 'unknown' | 'denied' | 'granted' | 'disabled',
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

  afterEach(() => {
    discardRegistrationSessionState()
    vi.useRealTimers()
  })

  describe('rememberRegistrationSuccess', () => {
    it('stores a versioned marker with stable delivery metadata and allowlisted attribution', () => {
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))

      const persisted = rememberRegistrationSuccess({
        method: 'email',
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
        method: 'email',
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
      expect(persisted).toBe(true)
    })

    it('persists the latest email marker while consent is unknown so a later grant can flush it', async () => {
      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'email', utmInfo: { utm_source: 'first' } })
      rememberRegistrationSuccess({ method: 'email', utmInfo: { utm_source: 'latest' } })

      expect(getStoredMarker()).toMatchObject({
        version: 2,
        method: 'email',
        attribution: { utm_source: 'latest' },
      })

      await flushRegistrationSuccess()
      expect(mockTrackEvent).not.toHaveBeenCalled()

      mockConsent.value = 'granted'
      await flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('discards an unknown-consent marker on denial before a later grant can flush it', async () => {
      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'email' })

      coordinateRegistrationConsent('denied')
      mockConsent.value = 'granted'
      await flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('discards a pending marker and GA guard at an account boundary', async () => {
      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'email' })
      window.sessionStorage.setItem('oauth_registration_ga_sent', 'true')

      discardRegistrationSessionState()
      mockConsent.value = 'granted'
      await flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      expect(window.sessionStorage.getItem('oauth_registration_ga_sent')).toBeNull()
    })

    it.each(['denied', 'disabled'] as const)(
      'discards a stored marker when consent changes to %s',
      (consent) => {
        rememberRegistrationSuccess({ method: 'email' })

        coordinateRegistrationConsent(consent)

        expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      },
    )

    it('persists an oauth marker while consent is unknown so a reload can still flush it', async () => {
      mockConsent.value = 'unknown'
      rememberRegistrationSuccess({ method: 'oauth' })

      expect(getStoredMarker()).toMatchObject({ method: 'oauth' })

      mockConsent.value = 'granted'
      await flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
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

      expect(rememberRegistrationSuccess({ method: 'email' })).toBe(false)
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

    it.each(['rejected acknowledgement', 'non-success acknowledgement'] as const)(
      'continues with a replacement marker after a %s',
      async (oldAcknowledgement) => {
        const firstRegistrationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        const replacementRegistrationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        vi.spyOn(globalThis.crypto, 'randomUUID')
          .mockReturnValueOnce(firstRegistrationId)
          .mockReturnValueOnce(replacementRegistrationId)
        let resolveOldAcknowledgement!: (result: { code: number }) => void
        let rejectOldAcknowledgement!: (error: Error) => void
        const pendingOldAcknowledgement = new Promise<{ code: number }>((resolve, reject) => {
          resolveOldAcknowledgement = resolve
          rejectOldAcknowledgement = reject
        })
        mockTrackEvent
          .mockReturnValueOnce({ promise: pendingOldAcknowledgement })
          .mockImplementation(successResult)

        rememberRegistrationSuccess({ method: 'email' })
        const firstFlush = flushRegistrationSuccess()
        rememberRegistrationSuccess({ method: 'email' })
        const replacementFlush = flushRegistrationSuccess()

        expect(replacementFlush).toBe(firstFlush)
        expect(mockTrackEvent).toHaveBeenCalledTimes(1)

        if (oldAcknowledgement === 'rejected acknowledgement')
          rejectOldAcknowledgement(new Error('network failed'))
        else resolveOldAcknowledgement({ code: 500 })
        await firstFlush

        expect(mockTrackEvent).toHaveBeenCalledTimes(2)
        expect(mockTrackEvent.mock.calls[1]?.[2]).toEqual({
          insert_id: replacementRegistrationId,
          time: expect.any(Number),
        })
        expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      },
    )

    it('retries an acknowledgement-failed marker after the backoff delay', async () => {
      vi.useFakeTimers()
      rememberRegistrationSuccess({ method: 'email' })
      const marker = getStoredMarker()
      mockTrackEvent
        .mockReturnValueOnce({ promise: Promise.reject(new Error('network failed')) })
        .mockImplementation(successResult)

      await flushRegistrationSuccess()
      expect(getStoredMarker()).toEqual(marker)
      expect(mockTrackEvent).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)

      expect(mockTrackEvent).toHaveBeenCalledTimes(2)
      expect(mockTrackEvent.mock.calls[1]?.[2]).toEqual({
        insert_id: marker.registrationId,
        time: marker.occurredAt,
      })
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it('does not retry an acknowledgement-failed marker after an account boundary', async () => {
      rememberRegistrationSuccess({ method: 'email' })
      mockTrackEvent.mockReturnValueOnce({ promise: Promise.reject(new Error('network failed')) })

      await flushRegistrationSuccess()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).not.toBeNull()

      discardRegistrationSessionState()
      await flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    })

    it.each([
      ['session discard', 'resolves'] as const,
      ['session discard', 'rejects'] as const,
      ['denied consent', 'resolves'] as const,
      ['disabled analytics', 'resolves'] as const,
    ])(
      'isolates a new registration flush after %s while the old SDK acknowledgement %s',
      async (invalidation, oldAcknowledgement) => {
        const accountARegistrationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        const accountBRegistrationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        vi.spyOn(globalThis.crypto, 'randomUUID')
          .mockReturnValueOnce(accountARegistrationId)
          .mockReturnValueOnce(accountBRegistrationId)

        let resolveAccountA!: (result: { code: number }) => void
        let rejectAccountA!: (error: Error) => void
        let resolveAccountB!: (result: { code: number }) => void
        const accountAAcknowledgement = new Promise<{ code: number }>((resolve, reject) => {
          resolveAccountA = resolve
          rejectAccountA = reject
        })
        const accountBAcknowledgement = new Promise<{ code: number }>((resolve) => {
          resolveAccountB = resolve
        })
        mockTrackEvent
          .mockReturnValueOnce({ promise: accountAAcknowledgement })
          .mockReturnValueOnce({ promise: accountBAcknowledgement })

        rememberRegistrationSuccess({ method: 'email' })
        const accountAFlush = flushRegistrationSuccess()

        if (invalidation === 'session discard') {
          discardRegistrationSessionState()
        } else {
          const terminalConsent = invalidation === 'denied consent' ? 'denied' : 'disabled'
          mockConsent.value = terminalConsent
          coordinateRegistrationConsent(terminalConsent)
          mockConsent.value = 'granted'
        }

        rememberRegistrationSuccess({ method: 'email' })
        const accountBMarker = window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
        const accountBFlush = flushRegistrationSuccess()

        const settleAccountA = () => {
          if (oldAcknowledgement === 'resolves') resolveAccountA({ code: 200 })
          else rejectAccountA(new Error('account A request failed'))
        }

        try {
          expect(accountBMarker).not.toBeNull()
          expect(accountBFlush).not.toBe(accountAFlush)
          expect(mockTrackEvent).toHaveBeenCalledTimes(2)
          expect(mockTrackEvent.mock.calls.map((call) => call[2])).toEqual([
            { insert_id: accountARegistrationId, time: expect.any(Number) },
            { insert_id: accountBRegistrationId, time: expect.any(Number) },
          ])

          settleAccountA()
          await accountAFlush

          expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe(
            accountBMarker,
          )
          expect(flushRegistrationSuccess()).toBe(accountBFlush)
          expect(mockTrackEvent).toHaveBeenCalledTimes(2)

          resolveAccountB({ code: 200 })
          await accountBFlush

          expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
        } finally {
          settleAccountA()
          resolveAccountB({ code: 200 })
          await Promise.allSettled([accountAFlush, accountBFlush])
        }
      },
    )

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

    it('accepts a persisted timestamp just inside the five-minute clock-skew allowance', async () => {
      vi.setSystemTime(new Date('2026-08-26T09:04:59.999Z'))
      rememberRegistrationSuccess({ method: 'email' })
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))

      await flushRegistrationSuccess()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    })

    it('rejects a persisted timestamp just outside the five-minute clock-skew allowance', async () => {
      vi.setSystemTime(new Date('2026-08-26T09:05:00.001Z'))
      rememberRegistrationSuccess({ method: 'email' })
      vi.setSystemTime(new Date('2026-08-26T09:00:00.000Z'))

      await flushRegistrationSuccess()

      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
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
