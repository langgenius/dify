import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import { HomeStickyCatalogTabs, HomeStickyStateProvider } from '../home-sticky-state-provider'
import styles from '../home-sticky.module.css'

async function renderCatalog() {
  return render(
    <HomeStickyStateProvider>
      <button type="button">Before catalogs</button>
      <div
        id={MARKETPLACE_CONTAINER_ID}
        data-marketplace-standalone
        style={{ display: 'flex', height: 320, flexDirection: 'column', overflowY: 'auto' }}
      >
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            display: 'flex',
            height: 48,
            flexShrink: 0,
            alignItems: 'center',
            background: 'white',
          }}
        >
          <HomeStickyCatalogTabs>
            <div className={styles.headerCatalogTabs}>
              <HomeCatalogTabs
                isMarketplacePlatform
                labels={{ plugins: 'Plugins', templates: 'Templates' }}
              />
            </div>
          </HomeStickyCatalogTabs>
        </header>
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
    </HomeStickyStateProvider>,
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
    const header = screen.getByRole('banner').element()
    await expect.element(plugins).toBeVisible()
    const contentPlugin = plugins.element()
    const contentTemplates = templates.element()
    const flowTabs = screen.getByRole('group', { name: 'In-flow catalogs' }).element()
    const results = screen.getByRole('region', { name: 'Catalog results' }).element()
    const resultsOffset = () => results.getBoundingClientRect().top + scrollContainer.scrollTop
    const initialResultsOffset = resultsOffset()
    const initialScrollHeight = scrollContainer.scrollHeight
    const handoffScrollTop =
      flowTabs.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom

    await screen.getByRole('button', { name: 'Before catalogs' }).click()
    await userEvent.tab()
    await expect.element(plugins).toHaveFocus()
    expect(plugins.element()).toBe(contentPlugin)

    scrollContainer.scrollTo({ top: handoffScrollTop - 1 })
    await expect.poll(() => scrollContainer.scrollTop).toBe(handoffScrollTop - 1)
    await expect.element(plugins).toHaveFocus()
    expect(plugins.element()).toBe(contentPlugin)

    scrollContainer.scrollTo({ top: handoffScrollTop })
    await expect.element(plugins).toHaveFocus()
    await expect.poll(() => plugins.element() !== contentPlugin).toBe(true)
    await expect.element(plugins).toHaveFocus()
    await expect.element(plugins).toBeVisible()
    expect(resultsOffset()).toBeCloseTo(initialResultsOffset)
    expect(scrollContainer.scrollHeight).toBe(initialScrollHeight)
    await userEvent.tab()
    await expect.element(templates).toHaveFocus()
    expect(templates.element()).not.toBe(contentTemplates)
    await userEvent.tab()
    await expect.element(categories).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(templates).toHaveFocus()

    scrollContainer.scrollTo({ top: handoffScrollTop - 1 })
    await expect.element(templates).toHaveFocus()
    await expect.poll(() => templates.element()).toBe(contentTemplates)
    await expect.element(templates).toHaveFocus()
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
    const contentPlugin = plugins.element()
    await screen.getByRole('button', { name: 'Before catalogs' }).click()
    await userEvent.tab()
    await expect.element(plugins).toHaveFocus()
    document.getElementById(MARKETPLACE_CONTAINER_ID)!.scrollTo({ top: 300 })
    await expect.element(plugins).toHaveFocus()
    await expect.element(plugins).toBeVisible()
    expect(plugins.element()).toBe(contentPlugin)

    await page.viewport(880, 800)
    await expect.poll(() => plugins.element() !== contentPlugin).toBe(true)
    await expect.element(plugins).toHaveFocus()
    await expect.element(plugins).toBeVisible()
    await userEvent.tab()
    await expect.element(templates).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(plugins).toHaveFocus()

    await page.viewport(879, 800)
    await expect.poll(() => plugins.element()).toBe(contentPlugin)
    await expect.element(plugins).toHaveFocus()
    await userEvent.tab()
    await expect.element(templates).toHaveFocus()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'Categories' })).toHaveFocus()
  })
})
