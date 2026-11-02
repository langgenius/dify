import * as amplitude from '@amplitude/analytics-browser'
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mockConfig = vi.hoisted(() => ({
  AMPLITUDE_API_KEY: 'test-api-key',
}))
let AmplitudeProvider: typeof import('../AmplitudeProvider').AmplitudeProvider
let setAnalyticsConsent: typeof import('@/app/components/base/analytics-consent/consent-store').setAnalyticsConsent

vi.mock('@/config', () => ({
  get AMPLITUDE_API_KEY() {
    return mockConfig.AMPLITUDE_API_KEY
  },
}))

vi.mock('@amplitude/analytics-browser', () => ({
  init: vi.fn(),
  add: vi.fn(),
  setOptOut: vi.fn(),
  track: vi.fn(),
  flush: vi.fn(),
  setUserId: vi.fn(),
  Identify: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('@amplitude/plugin-session-replay-browser', () => ({
  sessionReplayPlugin: vi.fn(() => ({ name: 'session-replay' })),
}))

describe('AmplitudeProvider', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockConfig.AMPLITUDE_API_KEY = 'test-api-key'
    ;({ setAnalyticsConsent } =
      await import('@/app/components/base/analytics-consent/consent-store'))
    setAnalyticsConsent('granted')
    ;({ AmplitudeProvider } = await import('../AmplitudeProvider'))
  })

  describe('Component', () => {
    it('initializes amplitude when enabled', async () => {
      render(<AmplitudeProvider sessionReplaySampleRate={0.8} />)
      await waitFor(() => expect(amplitude.init).toHaveBeenCalledTimes(1))

      expect(amplitude.init).toHaveBeenCalledWith('test-api-key', expect.any(Object))
      expect(sessionReplayPlugin).toHaveBeenCalledWith({ sampleRate: 0.8 })
      expect(amplitude.add).toHaveBeenCalledTimes(2)
      expect(amplitude.setOptOut).toHaveBeenCalledWith(false)
    })

    it('does not re-initialize amplitude on remount', async () => {
      const { unmount } = render(<AmplitudeProvider sessionReplaySampleRate={0.8} />)

      unmount()
      render(<AmplitudeProvider sessionReplaySampleRate={0.8} />)
      await waitFor(() => expect(amplitude.init).toHaveBeenCalledTimes(1))

      expect(sessionReplayPlugin).toHaveBeenCalledTimes(1)
      expect(amplitude.add).toHaveBeenCalledTimes(2)
    })

    it('does not initialize amplitude when disabled', () => {
      mockConfig.AMPLITUDE_API_KEY = ''
      render(<AmplitudeProvider />)

      expect(amplitude.init).not.toHaveBeenCalled()
      expect(amplitude.add).not.toHaveBeenCalled()
    })

    it.each(['unknown', 'denied'] as const)(
      'does not initialize amplitude while consent is %s',
      (consent) => {
        setAnalyticsConsent(consent)

        render(<AmplitudeProvider />)

        expect(amplitude.init).not.toHaveBeenCalled()
        expect(amplitude.add).not.toHaveBeenCalled()
        expect(amplitude.setOptOut).not.toHaveBeenCalled()
      },
    )

    it('opts out on revoke and resumes without reinitializing', async () => {
      render(<AmplitudeProvider />)
      await waitFor(() => expect(amplitude.init).toHaveBeenCalledTimes(1))

      act(() => setAnalyticsConsent('denied'))

      expect(amplitude.setOptOut).toHaveBeenLastCalledWith(true)

      act(() => setAnalyticsConsent('granted'))

      expect(amplitude.setOptOut).toHaveBeenLastCalledWith(false)
      expect(amplitude.init).toHaveBeenCalledTimes(1)
      expect(sessionReplayPlugin).toHaveBeenCalledTimes(1)
      expect(amplitude.add).toHaveBeenCalledTimes(2)
    })

    it('opts out when the analytics layout runtime unmounts', async () => {
      const { unmount } = render(<AmplitudeProvider />)
      await waitFor(() => expect(amplitude.init).toHaveBeenCalledTimes(1))

      unmount()

      expect(amplitude.setOptOut).toHaveBeenLastCalledWith(true)
    })

    it.each(['revoke', 'unmount'] as const)(
      'does not start tracking when %s happens during SDK loading',
      async (action) => {
        const { unmount } = render(<AmplitudeProvider />)
        if (action === 'revoke') {
          act(() => setAnalyticsConsent('denied'))
        } else {
          unmount()
        }

        await act(async () => {
          await vi.dynamicImportSettled()
        })
        expect(amplitude.init).not.toHaveBeenCalled()
        expect(sessionReplayPlugin).not.toHaveBeenCalled()
      },
    )

    it('pageNameEnrichmentPlugin logic works as expected', async () => {
      render(<AmplitudeProvider />)
      await waitFor(() => expect(amplitude.init).toHaveBeenCalledTimes(1))
      const plugin = vi.mocked(amplitude.add).mock.calls[0]?.[0] as
        | amplitude.Types.EnrichmentPlugin
        | undefined
      expect(plugin).toBeDefined()
      if (!plugin?.execute || !plugin.setup)
        throw new Error('Expected page-name-enrichment plugin with setup/execute')

      expect(plugin.name).toBe('page-name-enrichment')

      const execute = plugin.execute
      const setup = plugin.setup
      type SetupFn = NonNullable<amplitude.Types.EnrichmentPlugin['setup']>
      const getPageTitle = (evt: amplitude.Types.Event | null | undefined) =>
        (evt?.event_properties as Record<string, unknown> | undefined)?.['[Amplitude] Page Title']

      await setup({} as Parameters<SetupFn>[0], {} as Parameters<SetupFn>[1])

      const originalUrl = window.location.href
      try {
        window.history.replaceState(null, '', '/datasets')
        const event: amplitude.Types.Event = {
          event_type: '[Amplitude] Page Viewed',
          event_properties: {},
        }
        const result = await execute(event)
        expect(getPageTitle(result)).toBe('Knowledge')
        window.history.replaceState(null, '', '/')
        await execute(event)
        expect(getPageTitle(event)).toBe('Home')
        window.history.replaceState(null, '', '/apps')
        await execute(event)
        expect(getPageTitle(event)).toBe('Studio')
        window.history.replaceState(null, '', '/agents')
        await execute(event)
        expect(getPageTitle(event)).toBe('Agents')
        window.history.replaceState(null, '', '/explore')
        await execute(event)
        expect(getPageTitle(event)).toBe('Explore')
        window.history.replaceState(null, '', '/tools')
        await execute(event)
        expect(getPageTitle(event)).toBe('Tools')
        window.history.replaceState(null, '', '/account')
        await execute(event)
        expect(getPageTitle(event)).toBe('Account')
        window.history.replaceState(null, '', '/signin')
        await execute(event)
        expect(getPageTitle(event)).toBe('Sign In')
        window.history.replaceState(null, '', '/signup')
        await execute(event)
        expect(getPageTitle(event)).toBe('Sign Up')
        window.history.replaceState(null, '', '/unknown')
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
      } finally {
        window.history.replaceState(null, '', originalUrl)
      }
    })
  })
})
