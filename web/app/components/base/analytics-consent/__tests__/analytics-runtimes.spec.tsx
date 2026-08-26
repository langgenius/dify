import { render, screen } from '@testing-library/react'
import { ConsoleAnalyticsRuntime } from '../console-analytics-runtime'
import { WebAppAnalyticsRuntime } from '../web-app-analytics-runtime'

vi.mock('../cookieyes-consent-bridge', () => ({
  CookieYesConsentBridge: () => <span data-testid="cookieyes-consent-bridge" />,
}))

vi.mock('@/app/components/base/amplitude', () => ({
  default: () => <span data-testid="console-amplitude-provider" />,
}))

vi.mock('@/app/components/base/amplitude/WebAppAmplitudeProvider', () => ({
  WebAppAmplitudeProvider: () => <span data-testid="web-app-amplitude-provider" />,
}))

vi.mock('@/app/components/external-attribution-recorder', () => ({
  default: () => <span data-testid="external-attribution-recorder" />,
}))

describe('analytics runtimes', () => {
  it('mounts full analytics consumers for the console', () => {
    render(<ConsoleAnalyticsRuntime />)

    expect(screen.getByTestId('cookieyes-consent-bridge')).toBeInTheDocument()
    expect(screen.getByTestId('console-amplitude-provider')).toBeInTheDocument()
    expect(screen.getByTestId('external-attribution-recorder')).toBeInTheDocument()
    expect(screen.queryByTestId('web-app-amplitude-provider')).toBeNull()
  })

  it('mounts only consent and custom-event Amplitude for WebApps', () => {
    render(<WebAppAnalyticsRuntime />)

    expect(screen.getByTestId('cookieyes-consent-bridge')).toBeInTheDocument()
    expect(screen.getByTestId('web-app-amplitude-provider')).toBeInTheDocument()
    expect(screen.queryByTestId('console-amplitude-provider')).toBeNull()
    expect(screen.queryByTestId('external-attribution-recorder')).toBeNull()
  })
})
