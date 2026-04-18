import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AmplitudeProvider from '../AmplitudeProvider'

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

describe('AmplitudeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.AMPLITUDE_API_KEY = 'test-api-key'
    mockConfig.IS_CLOUD_EDITION = true
  })

  describe('Component', () => {
    it('initializes amplitude when enabled', () => {
      render(<AmplitudeProvider sessionReplaySampleRate={0.8} />)

      expect(amplitude.init).toHaveBeenCalledWith('test-api-key', expect.any(Object))
      expect(sessionReplayPlugin).toHaveBeenCalledWith({ sampleRate: 0.8 })
      expect(amplitude.add).toHaveBeenCalledTimes(2)
    })

    it('does not initialize amplitude when disabled', () => {
      mockConfig.AMPLITUDE_API_KEY = ''
      render(<AmplitudeProvider />)

      expect(amplitude.init).not.toHaveBeenCalled()
      expect(amplitude.add).not.toHaveBeenCalled()
    })

    it('pageNameEnrichmentPlugin logic works as expected', async () => {
      render(<AmplitudeProvider />)
      const plugin = vi.mocked(amplitude.add).mock.calls[0]?.[0] as amplitude.Types.EnrichmentPlugin | undefined
      expect(plugin).toBeDefined()
      if (!plugin?.execute || !plugin.setup)
        throw new Error('Expected page-name-enrichment plugin with setup/execute')

      expect(plugin.name).toBe('page-name-enrichment')

      const execute = plugin.execute
      const setup = plugin.setup
      type SetupFn = NonNullable<amplitude.Types.EnrichmentPlugin['setup']>
      const getPageTitle = (evt: amplitude.Types.Event | null | undefined) =>
        (evt?.event_properties as Record<string, unknown> | undefined)?.['[Amplitude] Page Title']

      await setup(
        {} as Parameters<SetupFn>[0],
        {} as Parameters<SetupFn>[1],
      )

      const originalWindowLocation = window.location
      try {
        Object.defineProperty(window, 'location', {
          value: { pathname: '/datasets' },
          writable: true,
        })
        const event: amplitude.Types.Event = {
          event_type: '[Amplitude] Page Viewed',
          event_properties: {},
        }
        const result = await execute(event)
        expect(getPageTitle(result)).toBe('Knowledge')
        window.location.pathname = '/'
        await execute(event)
        expect(getPageTitle(event)).toBe('Home')
        window.location.pathname = '/apps'
        await execute(event)
        expect(getPageTitle(event)).toBe('Studio')
        window.location.pathname = '/explore'
        await execute(event)
        expect(getPageTitle(event)).toBe('Explore')
        window.location.pathname = '/tools'
        await execute(event)
        expect(getPageTitle(event)).toBe('Tools')
        window.location.pathname = '/account'
        await execute(event)
        expect(getPageTitle(event)).toBe('Account')
        window.location.pathname = '/signin'
        await execute(event)
        expect(getPageTitle(event)).toBe('Sign In')
        window.location.pathname = '/signup'
        await execute(event)
        expect(getPageTitle(event)).toBe('Sign Up')
        window.location.pathname = '/unknown'
        await execute(event)
        expect(getPageTitle(event)).toBe('Unknown')
        const otherEvent = {
          event_type: 'Button Clicked',
          event_properties: {},
        } as amplitude.Types.Event
        const otherResult = await execute(otherEvent)
        expect(getPageTitle(otherResult)).toBeUndefined()
        const noPropsEvent = {
          event_type: '[Amplitude] Page Viewed',
        } as amplitude.Types.Event
        const noPropsResult = await execute(noPropsEvent)
        expect(noPropsResult?.event_properties).toBeUndefined()
      }
      finally {
        Object.defineProperty(window, 'location', {
          value: originalWindowLocation,
          writable: true,
        })
      }
    })
  })
})
