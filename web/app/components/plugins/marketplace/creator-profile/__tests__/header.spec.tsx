import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CreatorProfileHeader from '../header'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.home.plugins': 'Plugins',
    'marketplace.home.templates': 'Templates',
    'marketplace.creatorProfile.searchPlaceholder': 'Search plugins or templates',
    'mainNav.marketplace': 'Marketplace',
  }

  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => translations[key] ?? key),
    }),
  }
})

vi.mock('../../home/home-guide', () => ({
  default: () => <div data-testid="marketplace-guide" />,
}))

vi.mock('../../home/marketplace-search-autocomplete', () => ({
  MarketplaceSearchAutocomplete: () => <div data-testid="marketplace-search" />,
}))

describe('CreatorProfileHeader', () => {
  it('returns to the native Marketplace without marking a catalog tab active', () => {
    render(<CreatorProfileHeader locale="en-US" onSuggestionSelect={vi.fn()} />)

    const pluginsLink = screen.getByRole('link', { name: 'Plugins' })
    const templatesLink = screen.getByRole('link', { name: 'Templates' })

    expect(pluginsLink).toHaveAttribute('href', '/marketplace')
    expect(pluginsLink).not.toHaveAttribute('aria-current')
    expect(pluginsLink).not.toHaveClass('bg-state-base-active')
    expect(templatesLink).not.toHaveAttribute('aria-current')
    expect(templatesLink).not.toHaveClass('bg-state-base-active')
    expect(screen.getByTestId('marketplace-guide')).toBeInTheDocument()
    expect(screen.queryByTestId('account-section')).not.toBeInTheDocument()
  })
})
