import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HomeCatalogNavigation from '../home-catalog-navigation'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: { ns?: string }) =>
        options?.ns ? `${options.ns}.${key}` : key,
      ),
    }),
  }
})

vi.mock('../../plugin-type-switch', () => ({
  default: ({ variant }: { variant?: string }) => (
    <div data-testid="plugin-type-switch" data-variant={variant} />
  ),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.dify.ai${path}?source=console`,
}))

describe('HomeCatalogNavigation', () => {
  it('keeps template navigation inside the Marketplace platform', () => {
    render(<HomeCatalogNavigation isMarketplacePlatform />)

    expect(screen.getByText('plugin.marketplace.home.plugins')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', '/templates')
    expect(screen.getByTestId('plugin-type-switch')).toHaveAttribute('data-variant', 'home')
  })

  it('links Dify users to the hosted Marketplace templates page', () => {
    render(<HomeCatalogNavigation isMarketplacePlatform={false} />)

    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', 'https://marketplace.dify.ai/templates?source=console')
  })
})
