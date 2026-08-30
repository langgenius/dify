import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomeHeader from '../home-header'

const mocks = vi.hoisted(() => ({
  marketplaceUrlPrefix: 'https://marketplace.dify.ai',
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      i18n: {
        language: 'en-US',
      },
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  defaultDocBaseUrl: 'https://docs.dify.ai',
}))

vi.mock('@/config', () => ({
  get MARKETPLACE_URL_PREFIX() {
    return mocks.marketplaceUrlPrefix
  },
}))

vi.mock('../home-sticky-state-provider', () => ({
  HomeStickyCatalogTabs: ({ children }: { children: React.ReactNode }) => children,
}))

describe('HomeHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.marketplaceUrlPrefix = 'https://marketplace.dify.ai'
  })

  it('shows Creator Center before the docs dropdown', () => {
    render(<HomeHeader isMarketplacePlatform />)

    const creatorCenterLink = screen.getByRole('link', { name: 'marketplace.home.creatorCenter' })
    const guideButton = screen.getByRole('button', { name: /requestSubmit/ })

    expect(creatorCenterLink).toHaveAttribute('href', 'https://creators.dify.ai/')
    expect(creatorCenterLink).toHaveAttribute('target', '_blank')
    expect(creatorCenterLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(creatorCenterLink.parentElement?.className).toMatch(/standaloneHeaderActions/)
    expect(creatorCenterLink.compareDocumentPosition(guideButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // Creator Center must be a single interactive element, not a link-wrapped button.
    expect(creatorCenterLink.querySelector('button')).toBeNull()
    expect(screen.queryByRole('link', { name: 'marketplace.home.guide' })).not.toBeInTheDocument()
  })

  it('links Creator Center to the staging Creators site in staging', () => {
    mocks.marketplaceUrlPrefix = 'https://marketplace-staging.dify.dev'

    render(<HomeHeader isMarketplacePlatform />)

    expect(screen.getByRole('link', { name: 'marketplace.home.creatorCenter' })).toHaveAttribute(
      'href',
      'https://creators-staging.dify.dev/',
    )
  })

  it('links Creator Center to the dev Creators site on marketplace.dify.dev', () => {
    mocks.marketplaceUrlPrefix = 'https://marketplace.dify.dev'

    render(<HomeHeader isMarketplacePlatform />)

    expect(screen.getByRole('link', { name: 'marketplace.home.creatorCenter' })).toHaveAttribute(
      'href',
      'https://creators.dify.dev/',
    )
  })

  it('falls back to the public Creator Center for a custom Marketplace origin', () => {
    mocks.marketplaceUrlPrefix = 'http://localhost:3000'

    render(<HomeHeader isMarketplacePlatform />)

    expect(screen.getByRole('link', { name: 'marketplace.home.creatorCenter' })).toHaveAttribute(
      'href',
      'https://creators.dify.ai/',
    )
  })

  it('renders the Marketplace wordmark without a Marketplace text label', () => {
    render(<HomeHeader isMarketplacePlatform />)

    const brandLink = screen.getByRole('link', { name: 'Dify Marketplace' })
    const [lightLogo, darkLogo] = brandLink.querySelectorAll('img')
    expect(lightLogo).toHaveAttribute('src', expect.stringContaining('dify-marketplace-logo.svg'))
    expect(darkLogo).toHaveAttribute(
      'src',
      expect.stringContaining('dify-marketplace-logo-dark.svg'),
    )
    expect(lightLogo).toHaveAttribute('width', '141.761')
    expect(lightLogo).toHaveAttribute('height', '16.386')
    expect(darkLogo).toHaveAttribute('width', '141.761')
    expect(darkLogo).toHaveAttribute('height', '16.386')
    expect(screen.queryByText('mainNav.marketplace')).not.toBeInTheDocument()
  })

  it('selects neither catalog tab on non-catalog pages', () => {
    render(
      <HomeHeader
        activeTab={null}
        catalogLabels={{
          plugins: 'Plugins',
          templates: 'Templates',
        }}
        isMarketplacePlatform
      />,
    )

    expect(screen.getByRole('link', { name: 'Plugins' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Templates' })).not.toHaveAttribute('aria-current')
  })

  it('shows Templates with only the active background on the Templates catalog', () => {
    render(
      <HomeHeader
        activeTab="templates"
        catalogLabels={{
          plugins: '插件',
          templates: '模板',
        }}
        isMarketplacePlatform
        language="zh-Hans"
      />,
    )

    expect(screen.getByRole('link', { name: '插件' })).not.toHaveAttribute('aria-current')
    const templatesTab = screen.getByRole('link', { name: '模板' })
    expect(templatesTab).toHaveAttribute('aria-current', 'page')
    expect(templatesTab).toHaveAttribute('href', '/templates?language=zh-Hans')
    expect(templatesTab).toHaveClass('bg-state-base-active')
    expect(templatesTab).not.toHaveClass('text-text-accent')
    expect(templatesTab.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
  })
})
