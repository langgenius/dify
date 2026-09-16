import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ListWrapper from '../list-wrapper'

const mockMarketplaceData = vi.hoisted(() => ({
  plugins: undefined as Plugin[] | undefined,
  pluginsTotal: 0,
  marketplaceCollections: [] as MarketplaceCollection[],
  marketplaceCollectionPluginsMap: {} as Record<string, Plugin[]>,
  isLoading: false,
  isRefreshing: false,
  isError: false,
  refetch: vi.fn(),
  isFetchingNextPage: false,
  page: 1,
}))

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (_selector: unknown, options?: Record<string, unknown>) =>
      `${options?.num ?? 0} plugins found`,
  }),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('../../sort-dropdown', () => ({
  default: () => <div>sort</div>,
}))

vi.mock('../index', () => ({
  default: () => (
    <div data-testid="catalog-results" style={{ height: 900, paddingTop: 80 }}>
      <span>Catalog result anchor</span>
    </div>
  ),
}))

vi.mock('../../state', () => ({
  useMarketplaceData: () => mockMarketplaceData,
}))

vi.mock('../../atoms', () => ({
  useSearchPluginText: () => [''],
}))

function SearchResultsHarness() {
  const [searchVersion, setSearchVersion] = useState(0)

  return (
    <div
      data-search-version={searchVersion}
      data-testid="marketplace-scroll-container"
      style={{ height: 320, overflowY: 'auto' }}
    >
      <button
        type="button"
        style={{ position: 'sticky', top: 0, zIndex: 1 }}
        onClick={() => {
          mockMarketplaceData.plugins = [{ plugin_id: 'plugin-1', name: 'Search result' } as Plugin]
          mockMarketplaceData.pluginsTotal = 1
          setSearchVersion((version) => version + 1)
        }}
      >
        Type search
      </button>
      <div aria-hidden style={{ height: 220 }} />
      <ListWrapper />
    </div>
  )
}

describe('Marketplace result scroll anchoring', () => {
  beforeEach(() => {
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.pluginsTotal = 0
  })

  // Scroll anchoring is owned by Chromium's layout engine and cannot be
  // represented faithfully by the happy-dom unit project.
  it('does not move the page when the first search result header appears', async () => {
    await page.viewport(1280, 720)
    const screen = await render(<SearchResultsHarness />)
    const scrollContainer = screen.getByTestId('marketplace-scroll-container').element()

    scrollContainer.scrollTop = 260
    await new Promise(requestAnimationFrame)
    const scrollTopBefore = scrollContainer.scrollTop

    await screen.getByRole('button', { name: 'Type search' }).click()
    await expect.element(screen.getByText('1 plugins found')).toBeVisible()
    await new Promise(requestAnimationFrame)

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
  })
})
