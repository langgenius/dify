import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAmplitudeInitialized, resetAmplitudeInitializationForTests } from '../init'

const mockConfig = vi.hoisted(() => ({
  AMPLITUDE_API_KEY: 'test-api-key',
  IS_CLOUD_EDITION: true,
}))

vi.mock('@/config', () => ({
  get AMPLITUDE_API_KEY() {
    return mockConfig.AMPLITUDE_API_KEY
  },
  get IS_CLOUD_EDITION() {
    return mockConfig.IS_CLOUD_EDITION
  },
  get isAmplitudeEnabled() {
    return mockConfig.IS_CLOUD_EDITION && !!mockConfig.AMPLITUDE_API_KEY
  },
}))

vi.mock('@amplitude/analytics-browser', () => ({
  init: vi.fn(),
  add: vi.fn(),
}))

vi.mock('@amplitude/plugin-session-replay-browser', () => ({
  sessionReplayPlugin: vi.fn(() => ({ name: 'session-replay' })),
}))

describe('amplitude init helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.AMPLITUDE_API_KEY = 'test-api-key'
    mockConfig.IS_CLOUD_EDITION = true
    resetAmplitudeInitializationForTests()
  })

  describe('ensureAmplitudeInitialized', () => {
    it('should initialize amplitude only once across repeated calls', () => {
      ensureAmplitudeInitialized({ sessionReplaySampleRate: 0.8 })
      ensureAmplitudeInitialized({ sessionReplaySampleRate: 0.2 })

      expect(amplitude.init).toHaveBeenCalledTimes(1)
      expect(sessionReplayPlugin).toHaveBeenCalledTimes(1)
      expect(sessionReplayPlugin).toHaveBeenCalledWith({ sampleRate: 0.8 })
      expect(amplitude.add).toHaveBeenCalledTimes(2)
    })

    it('should skip initialization when amplitude is disabled', () => {
      mockConfig.AMPLITUDE_API_KEY = ''

      ensureAmplitudeInitialized()

      expect(amplitude.init).not.toHaveBeenCalled()
      expect(sessionReplayPlugin).not.toHaveBeenCalled()
      expect(amplitude.add).not.toHaveBeenCalled()
    })
  })
})
