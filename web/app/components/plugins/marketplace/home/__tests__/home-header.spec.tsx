import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import HomeHeader from '../home-header'

const mocks = vi.hoisted(() => ({
  marketplaceUrlPrefix: 'https://marketplace.dify.ai',
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useLocale: () => 'en-US',
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
  useDocLink: () => (path?: string) => `https://docs.dify.ai/console${path || ''}`,
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

  it('keeps Creator Center and docs in the in-app header', () => {
    render(<HomeHeader isMarketplacePlatform={false} />)

    expect(screen.getByRole('link', { name: 'marketplace.home.creatorCenter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /marketplace\.home\.guide/ })).toBeInTheDocument()
  })

  it('links Creator Center alongside the docs dropdown', () => {
    render(<HomeHeader isMarketplacePlatform />)

    const creatorCenterLink = screen.getByRole('link', { name: 'marketplace.home.creatorCenter' })
    expect(screen.getByRole('button', { name: /marketplace\.home\.guide/ })).toBeInTheDocument()

    expect(creatorCenterLink).toHaveAttribute('href', 'https://creators.dify.ai/')
    expect(creatorCenterLink).toHaveAttribute('target', '_blank')
    expect(creatorCenterLink).toHaveAttribute('rel', 'noopener noreferrer')

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

  it('marks the active Templates catalog and preserves its language', () => {
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
  })
})
