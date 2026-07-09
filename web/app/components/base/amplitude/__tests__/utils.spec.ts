import { flushEvents, resetUser, setUserId, setUserProperties, trackEvent } from '../utils'

const mockState = vi.hoisted(() => ({
  enabled: true,
}))

const mockTrack = vi.hoisted(() => vi.fn())
const mockFlush = vi.hoisted(() => vi.fn())
const mockSetUserId = vi.hoisted(() => vi.fn())
const mockIdentify = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())

const MockIdentify = vi.hoisted(() =>
  class {
    setCalls: Array<[string, unknown]> = []

    set(key: string, value: unknown) {
      this.setCalls.push([key, value])
      return this
    }
  },
)

vi.mock('@/config', () => ({
  get isAmplitudeEnabled() {
    return mockState.enabled
  },
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
    mockState.enabled = true
  })

  describe('trackEvent', () => {
    it('should call amplitude.track and return its result when amplitude is enabled', () => {
      const trackResult = { promise: Promise.resolve({}) }
      mockTrack.mockReturnValue(trackResult)

      const result = trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).toHaveBeenCalledTimes(1)
      expect(mockTrack).toHaveBeenCalledWith('dataset_created', { source: 'wizard' })
      expect(result).toBe(trackResult)
    })

    it('should not call amplitude.track when amplitude is disabled', () => {
      mockState.enabled = false

      trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).not.toHaveBeenCalled()
    })
  })

  describe('flushEvents', () => {
    it('should call amplitude.flush and return its result when amplitude is enabled', () => {
      const flushResult = { promise: Promise.resolve() }
      mockFlush.mockReturnValue(flushResult)

      const result = flushEvents()

      expect(mockFlush).toHaveBeenCalledTimes(1)
      expect(result).toBe(flushResult)
    })

    it('should not call amplitude.flush when amplitude is disabled', () => {
      mockState.enabled = false

      flushEvents()

      expect(mockFlush).not.toHaveBeenCalled()
    })
  })

  describe('setUserId', () => {
    it('should call amplitude.setUserId when amplitude is enabled', () => {
      setUserId('user-123')

      expect(mockSetUserId).toHaveBeenCalledTimes(1)
      expect(mockSetUserId).toHaveBeenCalledWith('user-123')
    })

    it('should not call amplitude.setUserId when amplitude is disabled', () => {
      mockState.enabled = false

      setUserId('user-123')

      expect(mockSetUserId).not.toHaveBeenCalled()
    })
  })

  describe('setUserProperties', () => {
    it('should build identify event and call amplitude.identify when amplitude is enabled', () => {
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

    it('should not call amplitude.identify when amplitude is disabled', () => {
      mockState.enabled = false

      setUserProperties({ role: 'owner' })

      expect(mockIdentify).not.toHaveBeenCalled()
    })
  })

  describe('resetUser', () => {
    it('should call amplitude.reset when amplitude is enabled', () => {
      resetUser()

      expect(mockReset).toHaveBeenCalledTimes(1)
    })

    it('should not call amplitude.reset when amplitude is disabled', () => {
      mockState.enabled = false

      resetUser()

      expect(mockReset).not.toHaveBeenCalled()
    })
  })
})
