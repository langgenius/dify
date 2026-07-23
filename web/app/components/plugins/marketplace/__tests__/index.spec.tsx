import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: vi.fn().mockResolvedValue('en-US'),
}))

vi.mock('../hydration-server', () => ({
  HydrateQueryClient: ({
    children,
    isMarketplacePlatform,
  }: {
    children: React.ReactNode
    isMarketplacePlatform?: boolean
  }) => (
    <div data-testid="hydrate-query-client" data-marketplace-platform={String(Boolean(isMarketplacePlatform))}>{children}</div>
  ),
}))

vi.mock('../hydration-client', () => ({
  HydrateClient: ({
    children,
    isMarketplacePlatform,
  }: {
    children: React.ReactNode
    isMarketplacePlatform?: boolean
  }) => (
    <div data-testid="hydrate-client" data-marketplace-platform={String(Boolean(isMarketplacePlatform))}>{children}</div>
  ),
}))

vi.mock('../marketplace-header', () => ({
  default: ({
    marketplaceNav,
  }: {
    marketplaceNav?: React.ReactNode
  }) => (
    <div data-testid="marketplace-header">
      {marketplaceNav}
    </div>
  ),
}))

vi.mock('../marketplace-content', () => ({
  default: ({ showInstallButton }: { showInstallButton?: boolean }) => (
    <div data-testid="marketplace-content" data-show-install={String(Boolean(showInstallButton))}>MarketplaceContent</div>
  ),
}))

vi.mock('../home/banners', () => ({
  fetchPluginRecommendBanners: vi.fn().mockResolvedValue([]),
}))

vi.mock('../home', () => ({
  default: ({
    isMarketplacePlatform,
    showInstallButton,
  }: {
    isMarketplacePlatform: boolean
    showInstallButton: boolean
  }) => (
    <div
      data-testid="marketplace-home"
      data-marketplace-platform={String(isMarketplacePlatform)}
      data-show-install={String(showInstallButton)}
    />
  ),
}))

describe('Marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export a default async component', async () => {
    const mod = await import('../index')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default).toBe('function')
  })

  it('should render all child components with default props', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({})

    const { getByTestId } = render(element as React.ReactElement)

    expect(getByTestId('hydrate-query-client')).toBeInTheDocument()
    expect(getByTestId('hydrate-client')).toBeInTheDocument()
    expect(getByTestId('marketplace-header')).toBeInTheDocument()
    expect(getByTestId('marketplace-content')).toBeInTheDocument()
  })

  it('should pass showInstallButton=true by default to MarketplaceContent', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({})

    const { getByTestId } = render(element as React.ReactElement)

    const marketplaceContent = getByTestId('marketplace-content')
    expect(marketplaceContent.getAttribute('data-show-install')).toBe('true')
  })

  it('should pass showInstallButton=false when specified', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({ showInstallButton: false })

    const { getByTestId } = render(element as React.ReactElement)

    const marketplaceContent = getByTestId('marketplace-content')
    expect(marketplaceContent.getAttribute('data-show-install')).toBe('false')
  })

  it('should pass marketplaceNav to MarketplaceHeader', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({ marketplaceNav: <div data-testid="nav">Nav</div> })

    const { getByTestId } = render(element as React.ReactElement)

    expect(getByTestId('nav')).toBeInTheDocument()
  })

  it('should pass isMarketplacePlatform to hydrate wrappers', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({ isMarketplacePlatform: true })

    const { getByTestId } = render(element as React.ReactElement)

    expect(getByTestId('hydrate-query-client').getAttribute('data-marketplace-platform')).toBe('true')
    expect(getByTestId('hydrate-client').getAttribute('data-marketplace-platform')).toBe('true')
  })

  it('should render the shared homepage variant', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({
      variant: 'home',
      isMarketplacePlatform: true,
      showInstallButton: false,
      language: 'en-US',
    })

    const { getByTestId, queryByTestId } = render(element as React.ReactElement)

    expect(getByTestId('marketplace-home').getAttribute('data-marketplace-platform')).toBe('true')
    expect(getByTestId('marketplace-home').getAttribute('data-show-install')).toBe('false')
    expect(queryByTestId('marketplace-header')).not.toBeInTheDocument()
  })
})
