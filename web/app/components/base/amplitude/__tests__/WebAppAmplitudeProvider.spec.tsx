import { render } from '@testing-library/react'
import { trackWebAppEvent } from '../web-app-event'
import { WebAppAmplitudeProvider } from '../WebAppAmplitudeProvider'

const { mockClient, mockConsent } = vi.hoisted(() => ({
  mockClient: {
    ensureInitialized: vi.fn(),
    sendEvent: vi.fn(),
    setOptOut: vi.fn(),
  },
  mockConsent: {
    value: 'unknown' as 'unknown' | 'denied' | 'granted',
  },
}))

vi.mock('@/app/components/base/analytics-consent/consent-store', () => ({
  useAnalyticsConsent: () => mockConsent.value,
}))

vi.mock('../web-app-client', () => ({
  ensureWebAppAmplitudeInitialized: () => mockClient.ensureInitialized(),
  sendWebAppAmplitudeEvent: (...args: unknown[]) => mockClient.sendEvent(...args),
  setWebAppAmplitudeOptOut: (optOut: boolean) => mockClient.setOptOut(optOut),
}))

describe('WebAppAmplitudeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.ensureInitialized.mockReset()
    mockClient.ensureInitialized.mockReturnValue(Promise.resolve())
    mockConsent.value = 'unknown'
  })

  it('registers explicit tracking only while analytics consent is granted', () => {
    const { rerender } = render(<WebAppAmplitudeProvider />)

    trackWebAppEvent('webapp_run', { app_mode: 'agent-v2' })
    expect(mockClient.ensureInitialized).not.toHaveBeenCalled()
    expect(mockClient.sendEvent).not.toHaveBeenCalled()

    mockClient.ensureInitialized.mockReturnValue(new Promise(() => {}))
    mockConsent.value = 'granted'
    rerender(<WebAppAmplitudeProvider />)

    expect(mockClient.ensureInitialized).not.toHaveBeenCalled()

    trackWebAppEvent('webapp_run', { app_mode: 'agent-v2' })

    expect(mockClient.setOptOut).toHaveBeenLastCalledWith(false)
    expect(mockClient.sendEvent).toHaveBeenCalledWith('webapp_run', {
      app_mode: 'agent-v2',
    })

    mockConsent.value = 'denied'
    rerender(<WebAppAmplitudeProvider />)
    mockClient.sendEvent.mockClear()
    trackWebAppEvent('webapp_run', { app_mode: 'chatflow' })

    expect(mockClient.setOptOut).toHaveBeenLastCalledWith(true)
    expect(mockClient.sendEvent).not.toHaveBeenCalled()
  })

  it('unregisters tracking and opts out when the WebApp layout unmounts', () => {
    mockConsent.value = 'granted'
    const { unmount } = render(<WebAppAmplitudeProvider />)

    unmount()
    mockClient.sendEvent.mockClear()
    trackWebAppEvent('webapp_run', { app_mode: 'workflow' })

    expect(mockClient.setOptOut).toHaveBeenLastCalledWith(true)
    expect(mockClient.sendEvent).not.toHaveBeenCalled()
  })
})
