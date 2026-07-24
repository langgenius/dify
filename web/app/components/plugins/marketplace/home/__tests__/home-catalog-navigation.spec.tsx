import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HomeCatalogNavigation from '../home-catalog-navigation'
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
  it('keeps template navigation inside the Marketplace platform', () => {
    render(<HomeCatalogNavigation isMarketplacePlatform />)

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
    render(<HomeCatalogNavigation isMarketplacePlatform={false} />)

    expect(
      screen.getByRole('link', { name: /plugin\.marketplace\.home\.templates/ }),
    ).toHaveAttribute('href', 'https://marketplace.dify.ai/templates?source=console')
  })

  it('uses the compact category layout while pinned', () => {
    render(<HomeCatalogNavigation isMarketplacePlatform isPinned />)

    const navigationSection = screen.getByRole('region', { name: 'common.mainNav.marketplace' })
    const catalogTabs = screen.getByRole('navigation', { name: 'common.mainNav.marketplace' })

    expect(navigationSection).toHaveClass(styles.catalogNavigationPinned)
    expect(catalogTabs).toHaveClass(styles.catalogTabsPinned)
    expect(screen.getByTestId('plugin-type-switch')).toHaveClass(styles.categoriesPinned)
  })

  it('reports when the category navigation reaches the sticky header', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.id = 'marketplace-container'
    document.body.appendChild(scrollContainer)
    const onPinnedChange = vi.fn()

    render(<HomeCatalogNavigation isMarketplacePlatform onPinnedChange={onPinnedChange} />)

    const navigationSection = screen.getByRole('region', { name: 'common.mainNav.marketplace' })
    const pinTrigger = navigationSection.previousElementSibling as HTMLElement
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const triggerRect = vi
      .spyOn(pinTrigger, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 48, 100, 100))

    onPinnedChange.mockClear()
    fireEvent.scroll(scrollContainer)
    expect(onPinnedChange).toHaveBeenLastCalledWith(true)

    triggerRect.mockReturnValue(new DOMRect(0, 49, 100, 100))
    fireEvent.scroll(scrollContainer)
    expect(onPinnedChange).toHaveBeenLastCalledWith(false)

    scrollContainer.remove()
  })

  it('keeps the pinned state when compact styling moves the sticky section', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.id = 'marketplace-container'
    document.body.appendChild(scrollContainer)
    const onPinnedChange = vi.fn()

    render(<HomeCatalogNavigation isMarketplacePlatform isPinned onPinnedChange={onPinnedChange} />)

    const navigationSection = screen.getByRole('region', { name: 'common.mainNav.marketplace' })
    const pinTrigger = navigationSection.previousElementSibling as HTMLElement
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    vi.spyOn(pinTrigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 47, 100, 0))
    vi.spyOn(navigationSection, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 49, 100, 60),
    )

    onPinnedChange.mockClear()
    fireEvent.scroll(scrollContainer)

    expect(onPinnedChange).toHaveBeenLastCalledWith(true)

    scrollContainer.remove()
  })
})
