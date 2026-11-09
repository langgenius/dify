import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'

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
  default: () => <div data-testid="plugin-type-switch" />,
}))

describe('HomeCatalogNavigation', () => {
  const renderNavigation = (isMarketplacePlatform: boolean) => {
    return render(
      <HomeStickyStateProvider>
        <HomeCatalogNavigation
          isMarketplacePlatform={isMarketplacePlatform}
          catalogTabs={<HomeCatalogTabs isMarketplacePlatform={isMarketplacePlatform} />}
        />
      </HomeStickyStateProvider>,
    )
  }

  it('keeps template navigation inside the Marketplace platform', () => {
    renderNavigation(true)

    const activeTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    expect(activeTab).toHaveAttribute('aria-current', 'page')
    expect(activeTab).toHaveAttribute('href', '/plugins')
    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', '/templates')
  })

  it('leaves both catalog tabs inactive when no page is selected', () => {
    render(<HomeCatalogTabs activeTab={null} isMarketplacePlatform={false} />)

    const pluginsTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    const templatesTab = screen.getByRole('link', { name: 'plugin.marketplace.home.templates' })

    expect(pluginsTab).toHaveAttribute('href', '/marketplace')
    expect(pluginsTab).not.toHaveAttribute('aria-current')
    expect(templatesTab).not.toHaveAttribute('aria-current')
  })

  it('marks Templates as active when rendering the Templates catalog', () => {
    render(<HomeCatalogTabs activeTab="templates" isMarketplacePlatform />)

    const pluginsTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    const templatesTab = screen.getByRole('link', { name: 'plugin.marketplace.home.templates' })

    expect(pluginsTab).not.toHaveAttribute('aria-current')
    expect(templatesTab).toHaveAttribute('aria-current', 'page')
  })

  it('uses request-localized labels and preserves the selected language', () => {
    render(
      <HomeCatalogTabs
        isMarketplacePlatform
        labels={{
          plugins: '插件',
          templates: '模板',
        }}
        language="zh-Hans"
      />,
    )

    expect(screen.getByRole('link', { name: '插件' })).toHaveAttribute(
      'href',
      '/plugins?language=zh-Hans',
    )
    expect(screen.getByRole('link', { name: '模板' })).toHaveAttribute(
      'href',
      '/templates?language=zh-Hans',
    )
  })

  it('renders a supplied catalog category navigation', () => {
    render(
      <HomeStickyStateProvider>
        <HomeCatalogNavigation
          isMarketplacePlatform
          catalogTabs={<HomeCatalogTabs activeTab="templates" isMarketplacePlatform />}
          catalogCategories={<nav aria-label="Template categories">Template categories</nav>}
        />
      </HomeStickyStateProvider>,
    )

    expect(screen.getByRole('navigation', { name: 'Template categories' })).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-type-switch')).not.toBeInTheDocument()
  })

  it('keeps Dify catalog navigation on the current origin', () => {
    renderNavigation(false)

    expect(screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })).toHaveAttribute(
      'href',
      '/marketplace',
    )
    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', '/templates')
  })
})
