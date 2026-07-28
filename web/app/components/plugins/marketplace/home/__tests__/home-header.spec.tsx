import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HomeHeader from '../home-header'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => 'https://docs.dify.ai/en/home',
}))

vi.mock('../home-sticky-state-provider', () => ({
  HomeStickyCatalogTabs: ({ children }: { children: React.ReactNode }) => children,
}))

describe('HomeHeader', () => {
  it('links the Guide action to Dify documentation', () => {
    render(<HomeHeader isMarketplacePlatform />)

    const guideLink = screen.getByRole('link', { name: 'Guide' })
    expect(guideLink).toHaveAttribute('href', 'https://docs.dify.ai/en/home')
    expect(guideLink).toHaveAttribute('target', '_blank')
    expect(guideLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows Templates as the active compact tab on the Templates catalog', () => {
    render(<HomeHeader activeTab="templates" isMarketplacePlatform />)

    expect(screen.getByRole('link', { name: 'marketplace.home.plugins' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: 'marketplace.home.templates' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
