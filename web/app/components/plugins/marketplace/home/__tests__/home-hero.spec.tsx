import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HomeHero from '../home-hero'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

describe('HomeHero', () => {
  it('renders catalog-specific copy when supplied', () => {
    render(
      <HomeHero
        isMarketplacePlatform
        title="Discover templates"
        subtitle="Start faster with ready-to-use workflows."
      />,
    )

    expect(screen.getByRole('heading', { name: 'Discover templates' })).toBeInTheDocument()
    expect(screen.getByText('Start faster with ready-to-use workflows.')).toBeInTheDocument()
    expect(screen.queryByText('marketplace.home.heroTitle')).not.toBeInTheDocument()
  })
})
