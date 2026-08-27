import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import { HomeStickyCatalogTabs, HomeStickyStateProvider } from '../home-sticky-state-provider'
import styles from '../home-sticky.module.css'

describe('Marketplace catalog tab handoff', () => {
  it('keeps the sticky navigation geometry stable while fading its tabs into the header', async () => {
    await page.viewport(1200, 800)
    const screen = await render(
      <HomeStickyStateProvider>
        <div
          id={MARKETPLACE_CONTAINER_ID}
          data-marketplace-standalone
          style={{ display: 'flex', height: 320, flexDirection: 'column', overflowY: 'auto' }}
        >
          <div style={{ display: 'flex', height: 48, flexShrink: 0 }}>
            <HomeStickyCatalogTabs>
              <div className={styles.headerCatalogTabs} data-testid="header-catalog-tabs">
                <HomeCatalogTabs
                  isMarketplacePlatform
                  labels={{ plugins: 'Plugins', templates: 'Templates' }}
                />
              </div>
            </HomeStickyCatalogTabs>
          </div>
          <div style={{ height: 220, flexShrink: 0 }} />
          <HomeCatalogNavigation
            isMarketplacePlatform
            catalogCategories={<div data-testid="catalog-categories">Categories</div>}
            catalogTabs={(
              <div data-testid="content-catalog-tabs">
                <HomeCatalogTabs
                  isMarketplacePlatform
                  labels={{ plugins: 'Plugins', templates: 'Templates' }}
                />
              </div>
            )}
          />
          <div data-testid="following-content" style={{ height: 640, flexShrink: 0 }} />
        </div>
      </HomeStickyStateProvider>,
    )

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const navigation = screen.getByRole('region').element()
    const categories = screen.getByTestId('catalog-categories').element()
    const contentTabsSlot = screen.getByTestId('content-catalog-tabs').element().parentElement!
    const headerTabsSlot = screen.getByTestId('header-catalog-tabs').element().parentElement!
    const followingContent = screen.getByTestId('following-content').element() as HTMLElement
    const initialHeight = navigation.getBoundingClientRect().height
    const initialCategoryOffset =
      categories.getBoundingClientRect().top - navigation.getBoundingClientRect().top
    const initialHeaderSlotWidth = headerTabsSlot.getBoundingClientRect().width
    const initialHeaderSlotHeight = headerTabsSlot.getBoundingClientRect().height
    const initialFollowingOffset = followingContent.offsetTop
    const initialScrollHeight = scrollContainer.scrollHeight
    const contentPluginsLink = contentTabsSlot.querySelector<HTMLAnchorElement>('a[href="/plugins"]')!
    const headerPluginsLink = headerTabsSlot.querySelector<HTMLAnchorElement>('a[href="/plugins"]')!

    expect(initialHeaderSlotWidth).toBeGreaterThan(0)
    expect(initialHeaderSlotHeight).toBeGreaterThan(0)
    expect(getComputedStyle(headerTabsSlot).pointerEvents).toBe('none')
    expect(getComputedStyle(headerTabsSlot).transitionProperty).toBe('opacity, transform')
    expect(getComputedStyle(headerTabsSlot).transitionDuration).toBe('0.14s')

    contentPluginsLink.focus()
    expect(document.activeElement).toBe(contentPluginsLink)

    scrollContainer.scrollTop = 260
    scrollContainer.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => {
      expect(navigation).toHaveClass(styles.catalogNavigationPinned!)
    })

    expect(navigation.getBoundingClientRect().height).toBeCloseTo(initialHeight)
    expect(
      categories.getBoundingClientRect().top - navigation.getBoundingClientRect().top,
    ).toBeCloseTo(initialCategoryOffset)
    expect(headerTabsSlot.getBoundingClientRect().width).toBeCloseTo(initialHeaderSlotWidth)
    expect(headerTabsSlot.getBoundingClientRect().height).toBeCloseTo(initialHeaderSlotHeight)
    expect(followingContent.offsetTop).toBe(initialFollowingOffset)
    expect(scrollContainer.scrollHeight).toBe(initialScrollHeight)
    expect(getComputedStyle(contentTabsSlot).display).not.toBe('none')
    expect(getComputedStyle(contentTabsSlot).pointerEvents).toBe('none')
    expect(getComputedStyle(contentTabsSlot).transitionProperty).toBe('opacity, transform')
    expect(getComputedStyle(contentTabsSlot).transitionDuration).toBe('0.14s')
    expect(contentTabsSlot).toHaveAttribute('aria-hidden', 'true')
    expect(contentTabsSlot).toHaveAttribute('inert')
    expect(headerTabsSlot).not.toHaveAttribute('aria-hidden')
    expect(headerTabsSlot).not.toHaveAttribute('inert')
    expect(getComputedStyle(headerTabsSlot).pointerEvents).toBe('auto')
    await vi.waitFor(() => {
      expect(getComputedStyle(contentTabsSlot).opacity).toBe('0')
      expect(getComputedStyle(headerTabsSlot).opacity).toBe('1')
      expect(document.activeElement).toBe(headerPluginsLink)
    }, { timeout: 500 })

    scrollContainer.scrollTop = 0
    scrollContainer.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => {
      expect(navigation).not.toHaveClass(styles.catalogNavigationPinned!)
      expect(document.activeElement).toBe(contentPluginsLink)
    })

    expect(contentTabsSlot).not.toHaveAttribute('aria-hidden')
    expect(contentTabsSlot).not.toHaveAttribute('inert')
    expect(headerTabsSlot).toHaveAttribute('aria-hidden', 'true')
    expect(headerTabsSlot).toHaveAttribute('inert')
  })

  it('keeps the in-flow tabs active when the standalone header slot is hidden on mobile', async () => {
    await page.viewport(879, 800)
    const screen = await render(
      <HomeStickyStateProvider>
        <div
          id={MARKETPLACE_CONTAINER_ID}
          data-marketplace-standalone
          style={{ display: 'flex', height: 320, flexDirection: 'column', overflowY: 'auto' }}
        >
          <div style={{ display: 'flex', height: 48, flexShrink: 0 }}>
            <HomeStickyCatalogTabs>
              <div className={styles.headerCatalogTabs} data-testid="mobile-header-tabs">
                Header tabs
              </div>
            </HomeStickyCatalogTabs>
          </div>
          <div style={{ height: 220, flexShrink: 0 }} />
          <HomeCatalogNavigation
            isMarketplacePlatform
            catalogCategories={<div>Categories</div>}
            catalogTabs={<div data-testid="mobile-content-tabs">Content tabs</div>}
          />
          <div style={{ height: 640, flexShrink: 0 }} />
        </div>
      </HomeStickyStateProvider>,
    )

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const navigation = screen.getByRole('region').element()
    const contentTabsSlot = screen.getByTestId('mobile-content-tabs').element().parentElement!
    const headerTabs = screen.getByTestId('mobile-header-tabs').element()
    const headerTabsSlot = headerTabs.parentElement!

    expect(getComputedStyle(headerTabs).display).toBe('none')

    scrollContainer.scrollTop = 260
    scrollContainer.dispatchEvent(new Event('scroll'))

    expect(navigation).not.toHaveClass(styles.catalogNavigationPinned!)
    expect(contentTabsSlot).not.toHaveAttribute('aria-hidden')
    expect(contentTabsSlot).not.toHaveAttribute('inert')
    expect(getComputedStyle(contentTabsSlot).opacity).toBe('1')
    expect(getComputedStyle(contentTabsSlot).pointerEvents).toBe('auto')
    expect(headerTabsSlot).toHaveAttribute('aria-hidden', 'true')
    expect(headerTabsSlot).toHaveAttribute('inert')

    await page.viewport(880, 800)
    await vi.waitFor(() => {
      expect(navigation).toHaveClass(styles.catalogNavigationPinned!)
    })
    expect(getComputedStyle(headerTabs).display).toBe('flex')
    expect(contentTabsSlot).toHaveAttribute('aria-hidden', 'true')
    expect(contentTabsSlot).toHaveAttribute('inert')
    expect(headerTabsSlot).not.toHaveAttribute('aria-hidden')
    expect(headerTabsSlot).not.toHaveAttribute('inert')

    await page.viewport(879, 800)
    await vi.waitFor(() => {
      expect(navigation).not.toHaveClass(styles.catalogNavigationPinned!)
    })
    expect(contentTabsSlot).not.toHaveAttribute('aria-hidden')
    expect(contentTabsSlot).not.toHaveAttribute('inert')
    expect(headerTabsSlot).toHaveAttribute('aria-hidden', 'true')
    expect(headerTabsSlot).toHaveAttribute('inert')
  })
})
