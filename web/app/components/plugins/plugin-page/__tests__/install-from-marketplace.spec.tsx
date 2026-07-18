import type { Plugin } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../types'
import InstallFromMarketplace from '../install-from-marketplace'

const mockUseMarketplacePlugins = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn(
    (path: string, { theme }: { theme?: string }) =>
      `https://marketplace.example${path}?theme=${theme}`,
  ),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: (params: unknown) => mockUseMarketplacePlugins(params),
}))

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({
    cardContainerClassName,
    cardRender,
    plugins,
    showInstallButton,
  }: {
    cardContainerClassName?: string
    cardRender: (plugin: Plugin) => React.ReactNode
    plugins: Plugin[]
    showInstallButton?: boolean
  }) => (
    <div
      className={cardContainerClassName}
      data-show-install-button={showInstallButton ? 'true' : 'false'}
      data-testid="marketplace-list"
    >
      {plugins.map((plugin) => cardRender(plugin))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/provider-card', () => ({
  default: ({ className, payload }: { className?: string; payload: Plugin }) => (
    <div className={className} data-testid={`provider-card-${payload.plugin_id}`} />
  ),
}))

const marketplacePlugins = [
  {
    category: PluginCategoryEnum.trigger,
    plugin_id: 'market-trigger',
    type: 'plugin',
  } as Plugin,
  {
    category: PluginCategoryEnum.trigger,
    plugin_id: 'market-bundle',
    type: 'bundle',
  } as Plugin,
]

describe('InstallFromMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({ theme: 'light' } as ReturnType<typeof useTheme>)
    mockUseMarketplacePlugins.mockReturnValue({
      data: { pages: [{ plugins: marketplacePlugins }] },
      isPending: false,
    })
  })

  it('queries and renders marketplace plugins for the selected category', () => {
    render(
      <InstallFromMarketplace
        canInstall
        category={PluginCategoryEnum.trigger}
        installedPluginIds={['installed-trigger']}
        searchText="calendar"
        tags={['productivity']}
      />,
    )

    expect(mockUseMarketplacePlugins).toHaveBeenCalledWith({
      category: PluginCategoryEnum.trigger,
      exclude: ['installed-trigger'],
      page_size: 1000,
      query: 'calendar',
      sort_by: 'install_count',
      sort_order: 'DESC',
      tags: ['productivity'],
      type: 'plugin',
    })
    expect(screen.getByTestId('marketplace-list')).toHaveClass('grid-cols-3', 'gap-2')
    expect(screen.getByTestId('marketplace-list')).toHaveAttribute(
      'data-show-install-button',
      'true',
    )
    expect(screen.getByTestId('provider-card-market-trigger')).toHaveClass('h-[146px]')
    expect(screen.queryByTestId('provider-card-market-bundle')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
    ).toHaveAttribute('href', 'https://marketplace.example/plugins/trigger?theme=light')
  })

  it('collapses and expands the marketplace list', () => {
    render(
      <InstallFromMarketplace
        canInstall
        category={PluginCategoryEnum.agent}
        installedPluginIds={[]}
        searchText=""
        tags={[]}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'plugin.marketplace.moreFrom' })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('marketplace-list')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('marketplace-list')).toBeInTheDocument()
  })

  it('uses the in-app marketplace action when provided', () => {
    const onOpenMarketplace = vi.fn()
    render(
      <InstallFromMarketplace
        canInstall={false}
        category={PluginCategoryEnum.extension}
        installedPluginIds={[]}
        onOpenMarketplace={onOpenMarketplace}
        searchText=""
        tags={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.difyMarketplace' }))

    expect(onOpenMarketplace).toHaveBeenCalledOnce()
    expect(screen.getByTestId('marketplace-list')).toHaveAttribute(
      'data-show-install-button',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
    ).not.toBeInTheDocument()
  })
})
