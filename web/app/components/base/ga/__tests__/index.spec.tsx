import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { GoogleAnalyticsTagScripts, GoogleConsentDefaults } from '../index'

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
      data-testid="mock-next-script"
      data-id={id ?? ''}
      data-inline={typeof children === 'string' ? children : ''}
      data-nonce={nonce ?? ''}
      data-src={src ?? ''}
      data-strategy={strategy ?? ''}
    />
  ),
}))

function AnalyticsScripts({ nonce }: { nonce?: string }) {
  return (
    <>
      <GoogleConsentDefaults nonce={nonce} />
      <GoogleAnalyticsTagScripts nonce={nonce} />
    </>
  )
}

describe('Google Analytics scripts', () => {
  it('renders denied consent defaults before the Google Analytics scripts', () => {
    const { container } = render(<AnalyticsScripts nonce="test-nonce" />)

    const scripts = Array.from(container.querySelectorAll('script'))
    expect(scripts).toHaveLength(3)

    expect(scripts[0]).toHaveAttribute('data-id', 'google-consent-defaults')
    expect(scripts[0]).toHaveAttribute('data-strategy', 'beforeInteractive')
    expect(scripts[0]).toHaveAttribute(
      'data-inline',
      expect.stringContaining(`window.gtag('consent', 'default'`),
    )
    expect(scripts[0]).toHaveAttribute(
      'data-inline',
      expect.stringContaining(`analytics_storage: 'denied'`),
    )

    expect(scripts[1]).toHaveAttribute('data-id', 'google-analytics')
    expect(scripts[1]).toHaveAttribute('data-strategy', 'afterInteractive')
    expect(scripts[1]).toHaveAttribute(
      'data-src',
      'https://www.googletagmanager.com/gtag/js?id=G-DM9497FN4V',
    )

    expect(scripts[2]).toHaveAttribute('data-id', 'google-analytics-init')
    expect(scripts[2]).toHaveAttribute('data-strategy', 'afterInteractive')
    expect(scripts[2]).toHaveAttribute(
      'data-inline',
      expect.stringContaining(`window.gtag('config', 'G-DM9497FN4V');`),
    )

    scripts.forEach((script) => {
      expect(script).toHaveAttribute('data-nonce', 'test-nonce')
    })
  })

  it('omits the nonce when none is provided', () => {
    const { container } = render(<AnalyticsScripts />)
    const scripts = Array.from(container.querySelectorAll('script'))

    scripts.forEach((script) => {
      expect(script).toHaveAttribute('data-nonce', '')
    })
  })
})
