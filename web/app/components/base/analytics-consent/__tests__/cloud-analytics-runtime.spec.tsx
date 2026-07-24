import { render, screen } from '@testing-library/react'
import { CloudAnalyticsRuntime } from '../cloud-analytics-runtime'

const mockState = vi.hoisted(() => ({ pathname: '/signin' }))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockState.pathname,
}))

vi.mock('../cookieyes-consent-bridge', () => ({
  CookieYesConsentBridge: () => <span data-testid="cookieyes-consent-bridge" />,
}))

vi.mock('@/app/components/base/amplitude', () => ({
  default: ({ active }: { active: boolean }) => (
    <span data-active={String(active)} data-testid="amplitude-provider" />
  ),
}))

vi.mock('@/app/components/external-attribution-recorder', () => ({
  default: () => <span data-testid="external-attribution-recorder" />,
}))

describe('CloudAnalyticsRuntime', () => {
  beforeEach(() => {
    mockState.pathname = '/signin'
  })

  it('keeps consent active across first-party Cloud routes', () => {
    const { rerender } = render(<CloudAnalyticsRuntime />)

    expect(screen.getByTestId('cookieyes-consent-bridge')).toBeInTheDocument()
    expect(screen.getByTestId('external-attribution-recorder')).toBeInTheDocument()
    expect(screen.getByTestId('amplitude-provider')).toHaveAttribute('data-active', 'true')

    mockState.pathname = '/integrations'
    rerender(<CloudAnalyticsRuntime />)

    expect(screen.getByTestId('amplitude-provider')).toHaveAttribute('data-active', 'true')
  })

  it('opts Amplitude out after a client transition into a share route', () => {
    const { rerender } = render(<CloudAnalyticsRuntime />)

    mockState.pathname = '/workflow/token'
    rerender(<CloudAnalyticsRuntime />)

    expect(screen.getByTestId('amplitude-provider')).toHaveAttribute('data-active', 'false')
  })
})
