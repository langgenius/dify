import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { CloudAnalyticsLayoutBoundary } from '../cloud-analytics-layout-boundary'

const mockState = vi.hoisted(() => ({
  layoutSegments: ['(commonLayout)', 'agents'],
}))

vi.mock('@/next/navigation', () => ({
  useSelectedLayoutSegments: () => mockState.layoutSegments,
}))

vi.mock('@/next/script', () => ({
  default: ({
    id,
    strategy,
    src,
    nonce,
    children,
  }: {
    id?: string
    strategy?: string
    src?: string
    nonce?: string
    children?: ReactNode
  }) => (
    <script
      data-id={id ?? ''}
      data-inline={typeof children === 'string' ? children : ''}
      data-nonce={nonce ?? ''}
      data-src={src ?? ''}
      data-strategy={strategy ?? ''}
    />
  ),
}))

vi.mock('../console-analytics-runtime', () => ({
  ConsoleAnalyticsRuntime: () => <span data-testid="console-analytics-runtime" />,
}))

vi.mock('../web-app-analytics-runtime', () => ({
  WebAppAnalyticsRuntime: () => <span data-testid="web-app-analytics-runtime" />,
}))

describe('CloudAnalyticsLayoutBoundary', () => {
  beforeEach(() => {
    mockState.layoutSegments = ['(commonLayout)', 'agents']
  })

  it('mounts analytics for the console layout, including the agents list', () => {
    const { container } = render(
      <CloudAnalyticsLayoutBoundary cookieYesSiteKey="site-key" nonce="test-nonce" />,
    )

    const scripts = Array.from(container.querySelectorAll('script'))
    const scriptIds = scripts.map(
      (script) => script.getAttribute('id') || script.getAttribute('data-id'),
    )
    expect(scriptIds).toEqual([
      'google-consent-defaults',
      'cookieyes',
      'google-analytics',
      'google-analytics-init',
    ])
    expect(container.querySelector('script[data-id="cookieyes"]')).toHaveAttribute(
      'data-src',
      'https://cdn-cookieyes.com/client_data/site-key/script.js',
    )
    expect(screen.getByTestId('console-analytics-runtime')).toBeInTheDocument()
    expect(screen.queryByTestId('web-app-analytics-runtime')).toBeNull()
  })

  it('mounts only consent and custom-event analytics for the published WebApp layout', () => {
    mockState.layoutSegments = ['(shareLayout)', 'agent', 'token']

    const { container } = render(
      <CloudAnalyticsLayoutBoundary cookieYesSiteKey="site-key" nonce="test-nonce" />,
    )

    const scriptIds = Array.from(container.querySelectorAll('script')).map(
      (script) => script.getAttribute('id') || script.getAttribute('data-id'),
    )
    expect(scriptIds).toEqual(['cookieyes'])
    expect(screen.queryByTestId('console-analytics-runtime')).toBeNull()
    expect(screen.getByTestId('web-app-analytics-runtime')).toBeInTheDocument()
  })

  it('switches analytics runtimes when navigation enters the WebApp layout', () => {
    const { rerender } = render(
      <CloudAnalyticsLayoutBoundary cookieYesSiteKey="site-key" nonce="test-nonce" />,
    )
    expect(screen.getByTestId('console-analytics-runtime')).toBeInTheDocument()

    mockState.layoutSegments = ['(shareLayout)', 'workflow', 'token']
    rerender(<CloudAnalyticsLayoutBoundary cookieYesSiteKey="site-key" nonce="test-nonce" />)

    expect(screen.queryByTestId('console-analytics-runtime')).toBeNull()
    expect(screen.getByTestId('web-app-analytics-runtime')).toBeInTheDocument()
  })
})
