import type { ReactNode } from 'react'
import { runInNewContext } from 'node:vm'
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
  it('denies tracking before initialization and forwards the CSP nonce', () => {
    const { container } = render(<AnalyticsScripts nonce="test-nonce" />)

    const scripts = Array.from(container.querySelectorAll('script'))
    expect(scripts).toHaveLength(3)

    expect(scripts[0]).toHaveAttribute('data-id', 'google-consent-defaults')
    expect(scripts[0]).toHaveAttribute('data-strategy', 'beforeInteractive')
    const scope = { dataLayer: [] as ArrayLike<unknown>[] }
    runInNewContext(scripts[0]!.getAttribute('data-inline')!, { window: scope })
    expect(Array.from(scope.dataLayer[0]!)).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      },
    ])

    expect(scripts[1]).toHaveAttribute('data-id', 'google-analytics')
    expect(scripts[1]).toHaveAttribute('data-strategy', 'afterInteractive')
    expect(scripts[2]).toHaveAttribute('data-id', 'google-analytics-init')
    expect(scripts[2]).toHaveAttribute('data-strategy', 'afterInteractive')
    runInNewContext(scripts[2]!.getAttribute('data-inline')!, { window: scope })
    const analyticsId = new URL(scripts[1]!.getAttribute('data-src')!).searchParams.get('id')
    expect(analyticsId).toBeTruthy()
    expect(Array.from(scope.dataLayer[2]!)).toEqual(['config', analyticsId])

    scripts.forEach((script) => {
      expect(script).toHaveAttribute('data-nonce', 'test-nonce')
    })
  })
})
