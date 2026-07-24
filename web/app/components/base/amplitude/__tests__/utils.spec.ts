import { flushEvents, resetUser, setUserId, setUserProperties, trackEvent } from '../utils'

const mockState = vi.hoisted(() => ({
  consent: 'granted' as 'unknown' | 'denied' | 'granted',
  initialized: true,
}))

const mockTrack = vi.hoisted(() => vi.fn())
const mockFlush = vi.hoisted(() => vi.fn())
const mockSetUserId = vi.hoisted(() => vi.fn())
const mockIdentify = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())

const MockIdentify = vi.hoisted(
  () =>
    class {
      setCalls: Array<[string, unknown]> = []

      set(key: string, value: unknown) {
        this.setCalls.push([key, value])
        return this
      }
    },
)

vi.mock('@/app/components/base/analytics-consent/consent-store', () => ({
  getAnalyticsConsent: () => mockState.consent,
}))

vi.mock('../init', () => ({
  getIsAmplitudeInitialized: () => mockState.initialized,
}))

vi.mock('@amplitude/analytics-browser', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
  setUserId: (...args: unknown[]) => mockSetUserId(...args),
  identify: (...args: unknown[]) => mockIdentify(...args),
  reset: (...args: unknown[]) => mockReset(...args),
  Identify: MockIdentify,
}))

describe('amplitude utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.consent = 'granted'
    mockState.initialized = true
  })

  describe('trackEvent', () => {
    it('should call amplitude.track and return its result when the consented SDK is initialized', () => {
      const trackResult = { promise: Promise.resolve({}) }
      mockTrack.mockReturnValue(trackResult)

      const result = trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).toHaveBeenCalledTimes(1)
      expect(mockTrack).toHaveBeenCalledWith('dataset_created', { source: 'wizard' })
      expect(result).toBe(trackResult)
    })

    it('should not call amplitude.track before the SDK initializes', () => {
      mockState.initialized = false

      trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).not.toHaveBeenCalled()
    })

    it.each(['unknown', 'denied'] as const)('should drop events while consent is %s', (consent) => {
      mockState.consent = consent

      trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).not.toHaveBeenCalled()
    })

    it('should drop events until the consented SDK has initialized', () => {
      mockState.initialized = false

      trackEvent('dataset_created')

      expect(mockTrack).not.toHaveBeenCalled()
    })
  })

  describe('flushEvents', () => {
    it('should call amplitude.flush and return its result when the consented SDK is initialized', () => {
      const flushResult = { promise: Promise.resolve() }
      mockFlush.mockReturnValue(flushResult)

      const result = flushEvents()

      expect(mockFlush).toHaveBeenCalledTimes(1)
      expect(result).toBe(flushResult)
    })

    it('should not call amplitude.flush before the SDK initializes', () => {
      mockState.initialized = false

      flushEvents()

      expect(mockFlush).not.toHaveBeenCalled()
    })

    it('should not flush when analytics consent is denied', () => {
      mockState.consent = 'denied'

      flushEvents()

      expect(mockFlush).not.toHaveBeenCalled()
    })
  })

  describe('setUserId', () => {
    it('should call amplitude.setUserId when the consented SDK is initialized', () => {
      setUserId('user-123')

      expect(mockSetUserId).toHaveBeenCalledTimes(1)
      expect(mockSetUserId).toHaveBeenCalledWith('user-123')
    })

    it('should not call amplitude.setUserId before the SDK initializes', () => {
      mockState.initialized = false

      setUserId('user-123')

      expect(mockSetUserId).not.toHaveBeenCalled()
    })

    it('should not set user id when analytics consent is denied', () => {
      mockState.consent = 'denied'

      setUserId('user-123')

      expect(mockSetUserId).not.toHaveBeenCalled()
    })
  })

  describe('setUserProperties', () => {
    it('should build an identify event when the consented SDK is initialized', () => {
      const properties = {
        role: 'owner',
        seats: 3,
        verified: true,
      }

      setUserProperties(properties)

      expect(mockIdentify).toHaveBeenCalledTimes(1)
      const identifyArg = mockIdentify.mock.calls[0]![0] as InstanceType<typeof MockIdentify>
      expect(identifyArg).toBeInstanceOf(MockIdentify)
      expect(identifyArg.setCalls).toEqual([
        ['role', 'owner'],
        ['seats', 3],
        ['verified', true],
      ])
    })

    it('should not call amplitude.identify before the SDK initializes', () => {
      mockState.initialized = false

      setUserProperties({ role: 'owner' })

      expect(mockIdentify).not.toHaveBeenCalled()
    })

    it('should not identify when analytics consent is denied', () => {
      mockState.consent = 'denied'

      setUserProperties({ role: 'owner' })

      expect(mockIdentify).not.toHaveBeenCalled()
    })
  })

  describe('resetUser', () => {
    it('should call amplitude.reset when the consented SDK is initialized', () => {
      resetUser()

      expect(mockReset).toHaveBeenCalledTimes(1)
    })

    it('should not call amplitude.reset before the SDK initializes', () => {
      mockState.initialized = false

      resetUser()

      expect(mockReset).not.toHaveBeenCalled()
    })

    it('should not reset when analytics consent is denied', () => {
      mockState.consent = 'denied'

      resetUser()

      expect(mockReset).not.toHaveBeenCalled()
    })
  })
})
