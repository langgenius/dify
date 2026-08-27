import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import { HomeStickyCatalogTabs, HomeStickyStateProvider } from '../home-sticky-state-provider'
import styles from '../home-sticky.module.css'

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
  default: ({ className, variant }: { className?: string; variant?: string }) => (
    <div data-testid="plugin-type-switch" className={className} data-variant={variant} />
  ),
}))

describe('HomeCatalogNavigation', () => {
  const renderNavigation = (isMarketplacePlatform: boolean) => {
    return render(
      <HomeStickyStateProvider>
        <HomeStickyCatalogTabs>
          <div data-testid="header-catalog-tabs" />
        </HomeStickyCatalogTabs>
        <HomeCatalogNavigation
          catalogTabs={<HomeCatalogTabs isMarketplacePlatform={isMarketplacePlatform} />}
        />
      </HomeStickyStateProvider>,
    )
  }

  it('keeps template navigation inside the Marketplace platform', () => {
    renderNavigation(true)

    const navigationSection = screen.getByRole('region', { name: 'common.mainNav.marketplace' })

    expect(navigationSection).toHaveClass(styles.catalogNavigation!)
    expect(navigationSection.firstElementChild).toHaveClass('w-full')
    expect(navigationSection.firstElementChild).not.toHaveClass('mx-auto', 'max-w-[1200px]')
    const activeTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    expect(activeTab).toHaveAttribute('aria-current', 'page')
    expect(activeTab).toHaveAttribute('href', '/plugins')
    expect(activeTab).toHaveClass('bg-state-base-active')
    expect(activeTab).not.toHaveClass('text-text-accent')
    expect(activeTab.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', '/templates')
    expect(screen.getByTestId('plugin-type-switch')).toHaveAttribute('data-variant', 'home')
  })

  it('keeps tabs clickable and uses only the active background', () => {
    render(<HomeCatalogTabs isMarketplacePlatform />)

    const pluginsTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    const templatesTab = screen.getByRole('link', { name: 'plugin.marketplace.home.templates' })

    expect(pluginsTab).toHaveAttribute('href', '/plugins')
    expect(pluginsTab).toHaveClass('cursor-pointer')
    expect(pluginsTab).toHaveClass('bg-state-base-active')
    expect(pluginsTab.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
    expect(templatesTab).toHaveAttribute('href', '/templates')
    expect(templatesTab).toHaveClass('cursor-pointer')
    expect(templatesTab).not.toHaveClass('bg-state-base-active')
  })

  it('leaves both catalog tabs inactive when no page is selected', () => {
    render(<HomeCatalogTabs activeTab={null} isMarketplacePlatform={false} />)

    const pluginsTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    const templatesTab = screen.getByRole('link', { name: 'plugin.marketplace.home.templates' })

    expect(pluginsTab).toHaveAttribute('href', '/marketplace')
    expect(pluginsTab).not.toHaveAttribute('aria-current')
    expect(pluginsTab).not.toHaveClass('bg-state-base-active')
    expect(templatesTab).not.toHaveAttribute('aria-current')
    expect(templatesTab).not.toHaveClass('bg-state-base-active')
  })

  it('marks Templates as active when rendering the Templates catalog', () => {
    render(<HomeCatalogTabs activeTab="templates" isMarketplacePlatform />)

    const pluginsTab = screen.getByRole('link', { name: 'plugin.marketplace.home.plugins' })
    const templatesTab = screen.getByRole('link', { name: 'plugin.marketplace.home.templates' })

    expect(pluginsTab).not.toHaveAttribute('aria-current')
    expect(pluginsTab).not.toHaveClass('bg-state-base-active')
    expect(pluginsTab.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
    expect(templatesTab).toHaveAttribute('aria-current', 'page')
    expect(templatesTab).toHaveClass('bg-state-base-active')
    expect(templatesTab).not.toHaveClass('text-text-accent')
    expect(templatesTab.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
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
          catalogTabs={<HomeCatalogTabs activeTab="templates" isMarketplacePlatform />}
          catalogCategories={<nav aria-label="Template categories">Template categories</nav>}
        />
      </HomeStickyStateProvider>,
    )

    expect(screen.getByRole('navigation', { name: 'Template categories' })).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-type-switch')).not.toBeInTheDocument()
  })

  it('uses a short divider between the leading tag filter and categories', () => {
    render(
      <HomeStickyStateProvider>
        <HomeCatalogNavigation
          catalogTabs={<HomeCatalogTabs isMarketplacePlatform />}
          catalogLeading={<div>Tags</div>}
          catalogTrailing={<div>Languages</div>}
          catalogCategories={<nav aria-label="Plugin categories">Categories</nav>}
        />
      </HomeStickyStateProvider>,
    )
    // Categories sit in the flex-1 scroller; the row is one level up.
    const row = screen.getByRole('navigation', { name: 'Plugin categories' }).parentElement
      ?.parentElement
    const divider = row?.children.item(1)

    expect(row?.children.item(0)).toHaveTextContent('Tags')
    expect(divider).toHaveAttribute('aria-hidden', 'true')
    expect(divider).toHaveClass(
      'mx-1',
      'h-3.5',
      'w-px',
      'shrink-0',
      'bg-divider-regular',
      styles.catalogLeadingDivider!,
    )
    expect(divider).toBeEmptyDOMElement()
    expect(row?.children.item(2)).toHaveTextContent('Categories')
    expect(row?.children.item(3)).toHaveTextContent('Languages')
    expect(row).not.toHaveTextContent('·')
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

  it('shows the compact navigation and header tabs after reaching the sticky header', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.id = 'marketplace-container'
    document.body.appendChild(scrollContainer)

    renderNavigation(true)

    const navigationSection = screen.getByRole('region', { name: 'common.mainNav.marketplace' })
    const pinTrigger = navigationSection.previousElementSibling as HTMLElement
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const triggerRect = vi
      .spyOn(pinTrigger, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 49, 100, 100))

    fireEvent.scroll(scrollContainer)
    expect(screen.queryByTestId('header-catalog-tabs')).not.toBeInTheDocument()

    triggerRect.mockReturnValue(new DOMRect(0, 48, 100, 100))
    fireEvent.scroll(scrollContainer)

    expect(navigationSection).toHaveClass(styles.catalogNavigationPinned!)
    expect(
      screen.getByRole('navigation', { name: 'common.mainNav.marketplace' }).parentElement,
    ).toHaveClass(styles.catalogTabsPinned!)
    expect(screen.getByTestId('plugin-type-switch').parentElement?.parentElement).toHaveClass(
      styles.categoriesPinned!,
    )
    expect(screen.getByTestId('header-catalog-tabs')).toBeInTheDocument()

    triggerRect.mockReturnValue(new DOMRect(0, 49, 100, 100))
    fireEvent.scroll(scrollContainer)

    expect(navigationSection).not.toHaveClass(styles.catalogNavigationPinned!)
    expect(screen.queryByTestId('header-catalog-tabs')).not.toBeInTheDocument()

    scrollContainer.remove()
  })

  it('keeps the pinned state when compact styling moves the sticky section', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.id = 'marketplace-container'
    document.body.appendChild(scrollContainer)

    renderNavigation(true)

    const navigationSection = screen.getByRole('region', { name: 'common.mainNav.marketplace' })
    const pinTrigger = navigationSection.previousElementSibling as HTMLElement
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    vi.spyOn(pinTrigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 47, 100, 0))
    vi.spyOn(navigationSection, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 49, 100, 60),
    )

    fireEvent.scroll(scrollContainer)

    expect(navigationSection).toHaveClass(styles.catalogNavigationPinned!)
    expect(screen.getByTestId('header-catalog-tabs')).toBeInTheDocument()

    scrollContainer.remove()
  })

  it('prevents scroll anchoring from reversing the sticky threshold', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.id = 'marketplace-container'
    document.body.appendChild(scrollContainer)

    const { unmount } = renderNavigation(true)

    expect(scrollContainer.style.overflowAnchor).toBe('none')

    unmount()
    expect(scrollContainer.style.overflowAnchor).toBe('')

    scrollContainer.remove()
  })
})
