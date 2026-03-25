import { resetUser, setUserId, setUserProperties, trackEvent } from '../utils'

const mockState = vi.hoisted(() => ({
  enabled: true,
}))

const mockTrack = vi.hoisted(() => vi.fn())
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
    it('should call amplitude.track when amplitude is enabled', () => {
      trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).toHaveBeenCalledTimes(1)
      expect(mockTrack).toHaveBeenCalledWith('dataset_created', { source: 'wizard' })
    })

    it('should not call amplitude.track when amplitude is disabled', () => {
      mockState.enabled = false

      trackEvent('dataset_created', { source: 'wizard' })

      expect(mockTrack).not.toHaveBeenCalled()
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
      const properties: Record<string, unknown> = {
        role: 'owner',
        seats: 3,
        verified: true,
      }

      setUserProperties(properties)

      expect(mockIdentify).toHaveBeenCalledTimes(1)
      const identifyArg = mockIdentify.mock.calls[0][0] as InstanceType<typeof MockIdentify>
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
