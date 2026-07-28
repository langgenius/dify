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

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.dify.ai${path}?source=console`,
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

    expect(navigationSection).toHaveClass(styles.catalogNavigation)
    expect(navigationSection.firstElementChild).toHaveClass('w-full')
    expect(navigationSection.firstElementChild).not.toHaveClass('mx-auto', 'max-w-[1200px]')
    const activeTab = screen.getByText('plugin.marketplace.home.plugins')
    expect(activeTab).toHaveAttribute('aria-current', 'page')
    expect(activeTab.querySelector('[aria-hidden="true"]')).toHaveClass(
      'absolute',
      'h-0.5',
      'w-[21px]',
      'bg-text-accent',
    )
    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', '/templates')
    expect(screen.getByTestId('plugin-type-switch')).toHaveAttribute('data-variant', 'home')
  })

  it('links Dify users to the hosted Marketplace templates page', () => {
    renderNavigation(false)

    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', 'https://marketplace.dify.ai/templates?source=console')
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

    expect(navigationSection).toHaveClass(styles.catalogNavigationPinned)
    expect(
      screen.getByRole('navigation', { name: 'common.mainNav.marketplace' }).parentElement,
    ).toHaveClass(styles.catalogTabsPinned)
    expect(screen.getByTestId('plugin-type-switch')).toHaveClass(styles.categoriesPinned)
    expect(screen.getByTestId('header-catalog-tabs')).toBeInTheDocument()

    triggerRect.mockReturnValue(new DOMRect(0, 49, 100, 100))
    fireEvent.scroll(scrollContainer)

    expect(navigationSection).not.toHaveClass(styles.catalogNavigationPinned)
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

    expect(navigationSection).toHaveClass(styles.catalogNavigationPinned)
    expect(screen.getByTestId('header-catalog-tabs')).toBeInTheDocument()

    scrollContainer.remove()
  })
})
