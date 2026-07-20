import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Description from '../index'

let locale = 'en-US'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useLocale: () => locale,
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

const createWrapper = () => {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  return ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsWrapper>{children}</NuqsWrapper>
    </JotaiProvider>
  )
}

describe('Description', () => {
  beforeEach(() => {
    locale = 'en-US'
  })

  it('renders the marketplace message in non-Chinese order', () => {
    render(<Description />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('marketplace.empower')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      /^marketplace\.discovercategory\.models,category\.tools,category\.datasources,category\.triggers,category\.agents,category\.extensionsmarketplace\.andcategory\.bundlesoperation\.inmarketplace\.difyMarketplace$/,
    )
  })

  it('renders the marketplace message in Simplified Chinese order', () => {
    locale = 'zh-Hans'
    render(<Description />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      /^operation\.inmarketplace\.difyMarketplacemarketplace\.discovercategory\.models,category\.tools,category\.datasources,category\.triggers,category\.agents,category\.extensionsmarketplace\.andcategory\.bundles$/,
    )
  })

  it('renders platform hero content and the provided navigation', () => {
    render(
      <Description
        isMarketplacePlatform
        marketplaceNav={<nav aria-label="Marketplace navigation" />}
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'marketplace.pluginsHeroTitle',
    )
    expect(screen.getByText('marketplace.pluginsHeroSubtitle')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Marketplace navigation' })).toBeInTheDocument()
  })
})
