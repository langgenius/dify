import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import HomeHeader from '../home-header'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'

async function renderCatalog() {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper()
  onTestFinished(() => queryClient.clear())
  return render(
    <Providers>
      <HomeStickyStateProvider>
        <div
          id={MARKETPLACE_CONTAINER_ID}
          data-marketplace-standalone
          style={{ display: 'flex', height: 320, flexDirection: 'column', overflowY: 'auto' }}
        >
          <HomeHeader
            isMarketplacePlatform
            catalogLabels={{ plugins: 'Plugins', templates: 'Templates' }}
          />
          <button type="button">Before catalogs</button>
          <div style={{ height: 220, flexShrink: 0 }} />
          <HomeCatalogNavigation
            isMarketplacePlatform
            catalogCategories={<button type="button">Categories</button>}
            catalogTabs={
              <div role="group" aria-label="In-flow catalogs">
                <HomeCatalogTabs
                  isMarketplacePlatform
                  labels={{ plugins: 'Plugins', templates: 'Templates' }}
                />
              </div>
            }
          />
          <section aria-label="Catalog results" style={{ height: 640, flexShrink: 0 }} />
        </div>
      </HomeStickyStateProvider>
    </Providers>,
  )
}

describe('Marketplace catalog tab handoff', () => {
  it('moves keyboard focus to the same catalog in the header without moving the results', async () => {
    await page.viewport(1200, 800)
    const screen = await renderCatalog()
    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const plugins = screen.getByRole('link', { name: 'Plugins' })
    const templates = screen.getByRole('link', { name: 'Templates' })
    const categories = screen.getByRole('button', { name: 'Categories' })
    const header = screen.getByRole('banner')
    await expect.element(plugins).toBeVisible()
    const flowTabs = screen.getByRole('group', { name: 'In-flow catalogs' }).element()
    const results = screen.getByRole('region', { name: 'Catalog results' }).element()
    const resultsOffset = () => results.getBoundingClientRect().top + scrollContainer.scrollTop
    const initialResultsOffset = resultsOffset()
    const initialScrollHeight = scrollContainer.scrollHeight
    const handoffScrollTop =
      flowTabs.getBoundingClientRect().bottom - header.element().getBoundingClientRect().bottom

    await screen.getByRole('button', { name: 'Before catalogs' }).click()
    await userEvent.tab()
    await expect
      .element(
        screen
          .getByRole('group', { name: 'In-flow catalogs' })
          .getByRole('link', { name: 'Plugins' }),
      )
      .toHaveFocus()

    scrollContainer.scrollTo({ top: handoffScrollTop - 1 })
    await expect.poll(() => scrollContainer.scrollTop).toBe(handoffScrollTop - 1)
    await expect
      .element(
        screen
          .getByRole('group', { name: 'In-flow catalogs' })
          .getByRole('link', { name: 'Plugins' }),
      )
      .toHaveFocus()

    scrollContainer.scrollTo({ top: handoffScrollTop })
    await expect.element(header.getByRole('link', { name: 'Plugins' })).toHaveFocus()
    await expect.element(plugins).toBeVisible()
    const pinnedLink = header.getByRole('link', { name: 'Plugins' }).element()
    const bounds = pinnedLink.getBoundingClientRect()
    await expect
      .poll(() =>
        pinnedLink.contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        ),
      )
      .toBe(true)
    expect(resultsOffset()).toBeCloseTo(initialResultsOffset)
    expect(scrollContainer.scrollHeight).toBe(initialScrollHeight)
    await userEvent.tab()
    await expect.element(header.getByRole('link', { name: 'Templates' })).toHaveFocus()
    await userEvent.tab()
    await expect
      .element(header.getByRole('link', { name: 'plugin.marketplace.home.creatorCenter' }))
      .toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(templates).toHaveFocus()

    scrollContainer.scrollTo({ top: handoffScrollTop - 1 })
    await expect
      .element(
        screen
          .getByRole('group', { name: 'In-flow catalogs' })
          .getByRole('link', { name: 'Templates' }),
      )
      .toHaveFocus()
    await userEvent.tab()
    await expect.element(categories).toHaveFocus()
  })

  // The focused desktop link is hidden before resize handoff can capture it: https://github.com/langgenius/dify/issues/46146
  it.fails('keeps real catalog links keyboard-operable as the mobile header appears and disappears', async () => {
    await page.viewport(879, 800)
    const screen = await renderCatalog()
    const plugins = screen.getByRole('link', { name: 'Plugins' })
    const templates = screen.getByRole('link', { name: 'Templates' })
    await expect.element(plugins).toBeVisible()
    await screen.getByRole('button', { name: 'Before catalogs' }).click()
    await userEvent.tab()
    await expect.element(plugins).toHaveFocus()
    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    scrollContainer.scrollTo({ top: 300 })
    await expect.poll(() => scrollContainer.scrollTop).toBe(300)
    await expect.element(plugins).toHaveFocus()
    await expect.element(plugins).toBeVisible()
    await expect
      .element(
        screen
          .getByRole('group', { name: 'In-flow catalogs' })
          .getByRole('link', { name: 'Plugins' }),
      )
      .toHaveFocus()

    await page.viewport(880, 800)
    await expect
      .element(screen.getByRole('banner').getByRole('link', { name: 'Plugins' }))
      .toHaveFocus()
    await expect.element(plugins).toBeVisible()
    await userEvent.tab()
    await expect.element(templates).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(plugins).toHaveFocus()

    await page.viewport(879, 800)
    await expect
      .element(
        screen
          .getByRole('group', { name: 'In-flow catalogs' })
          .getByRole('link', { name: 'Plugins' }),
      )
      .toHaveFocus()
    await expect.element(plugins).toHaveFocus()
    await userEvent.tab()
    await expect.element(templates).toHaveFocus()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'Categories' })).toHaveFocus()
  })
})
