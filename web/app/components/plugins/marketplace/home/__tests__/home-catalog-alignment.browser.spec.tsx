import { render } from 'vitest-browser-react'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'
import styles from '../home-sticky.module.css'

describe('Marketplace home catalog alignment', () => {
  it('aligns catalog tabs and filters with the content container', async () => {
    const screen = await render(
      <HomeStickyStateProvider>
        <div className="w-[1200px]" data-marketplace-standalone>
          <HomeCatalogNavigation
            catalogCategories={
              <div data-testid="catalog-filter" role="group" aria-label="Categories" />
            }
            catalogTabs={
              <HomeCatalogTabs
                isMarketplacePlatform
                labels={{ plugins: 'Plugins', templates: 'Templates' }}
              />
            }
          />
          <div className={`px-8 ${styles.catalogContent}`}>
            <div role="region" aria-label="Catalog content" className="h-10" />
          </div>
        </div>
      </HomeStickyStateProvider>,
    )

    const contentLeft = screen
      .getByRole('region', { name: 'Catalog content' })
      .element()
      .getBoundingClientRect().left
    const tabsLeft = screen.getByRole('navigation').element().getBoundingClientRect().left
    const filtersLeft = screen.getByTestId('catalog-filter').element().getBoundingClientRect().left

    expect(tabsLeft).toBeCloseTo(contentLeft)
    expect(filtersLeft).toBeCloseTo(contentLeft)
  })
})
