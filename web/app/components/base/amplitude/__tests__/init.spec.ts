import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  AMPLITUDE_API_KEY: 'test-api-key',
}))

let ensureAmplitudeInitialized: typeof import('../init').ensureAmplitudeInitialized

vi.mock('@/config', () => ({
  get AMPLITUDE_API_KEY() {
    return mockConfig.AMPLITUDE_API_KEY
  },
}))

vi.mock('@amplitude/analytics-browser', () => ({
  init: vi.fn(),
  add: vi.fn(),
  setOptOut: vi.fn(),
}))

vi.mock('@amplitude/plugin-session-replay-browser', () => ({
  sessionReplayPlugin: vi.fn(() => ({ name: 'session-replay' })),
}))

describe('amplitude init helper', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockConfig.AMPLITUDE_API_KEY = 'test-api-key'
    ;({ ensureAmplitudeInitialized } = await import('../init'))
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

    it('should expose readiness after initialization completes', async () => {
      const { getIsAmplitudeInitialized } = await import('../init')

      expect(getIsAmplitudeInitialized()).toBe(false)
      ensureAmplitudeInitialized()

      expect(getIsAmplitudeInitialized()).toBe(true)
    })

    it('should notify readiness subscribers after plugins are registered', async () => {
      const { subscribeAmplitudeInitialization } = await import('../init')
      const listener = vi.fn()
      const unsubscribe = subscribeAmplitudeInitialization(listener)

      ensureAmplitudeInitialized()

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('should skip initialization when amplitude is disabled', () => {
      mockConfig.AMPLITUDE_API_KEY = ''

      ensureAmplitudeInitialized()

      expect(amplitude.init).not.toHaveBeenCalled()
      expect(sessionReplayPlugin).not.toHaveBeenCalled()
      expect(amplitude.add).not.toHaveBeenCalled()
    })
  })

  describe('setAmplitudeOptOut', () => {
    it('only updates opt-out after amplitude has initialized', async () => {
      const { setAmplitudeOptOut } = await import('../init')

      setAmplitudeOptOut(true)
      expect(amplitude.setOptOut).not.toHaveBeenCalled()

      ensureAmplitudeInitialized()
      setAmplitudeOptOut(true)

      expect(amplitude.setOptOut).toHaveBeenCalledWith(true)
    })
  })
})
