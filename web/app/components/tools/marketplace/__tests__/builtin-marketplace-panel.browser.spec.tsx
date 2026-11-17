import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import { createRef } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { marketplaceLinks } from '@/features/marketplace/links'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { BuiltinMarketplacePanel } from '../builtin-marketplace-panel'

const requests = vi.hoisted(() => ({
  installed: vi.fn(),
  search: vi.fn(),
  collections: vi.fn(),
  collectionPlugins: vi.fn(),
}))
// boundary: Next routing is unavailable in the standalone browser page.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.installedIds.get': requests.installed,
      'workspaces.current.plugin.list.installations.ids.post': () => ({ plugins: [] }),
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collections: requests.collections,
      collectionPlugins: requests.collectionPlugins,
    },
  }
})
vi.mock('@/service/base', () => ({ postMarketplace: requests.search }))

const plugin = createMarketplacePluginFixture({ label: { en_US: 'Weather Tool' }, tags: [] })
const collection: MarketplaceCollection = {
  name: 'featured',
  label: { en_US: 'Featured tools' },
  description: { en_US: 'Recommended tools' },
  rule: '',
  created_at: '',
  updated_at: '',
  searchable: false,
  search_params: {},
}

beforeEach(() => {
  requests.installed.mockReset().mockResolvedValue({ plugin_ids: [] })
  requests.search.mockReset().mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
  requests.collections.mockReset().mockResolvedValue({ data: { collections: [collection] } })
  requests.collectionPlugins
    .mockReset()
    .mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
})

beforeEach(async () => {
  await page.viewport(1200, 800)
})

async function renderPanel(keywords = '', tagFilterValue: string[] = [], belowFold = false) {
  const containerRef = createRef<HTMLDivElement>()
  const { wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: [],
    systemFeatures: { rbac_enabled: true },
  })
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const screen = await render(
    <Providers>
      <UrlState>
        <div
          ref={containerRef}
          role="region"
          aria-label="Tools"
          style={{ position: 'relative', height: 400, overflowY: 'auto' }}
        >
          {belowFold && <div style={{ height: 1000 }}>Installed tools</div>}
          <BuiltinMarketplacePanel
            marketplace={marketplaceLinks}
            containerRef={containerRef}
            contentInset="default"
            keywords={keywords}
            tagFilterValue={tagFilterValue}
          />
        </div>
      </UrlState>
    </Providers>,
  )
  return screen
}

it('loads marketplace tools when native scrolling reveals the catalog', async () => {
  const screen = await renderPanel('', [], true)
  await expect.element(screen.getByText('Installed tools')).toBeVisible()
  expect(requests.installed).not.toHaveBeenCalled()
  expect(requests.collections).not.toHaveBeenCalled()
  const tools = screen.getByRole('region', { name: 'Tools' })
  tools.element().scrollTo({ top: tools.element().scrollHeight })
  await expect.element(screen.getByText('Weather Tool', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Featured tools', { exact: true })).toBeVisible()
})

it.each([
  { keywords: 'weather', tags: [] },
  { keywords: '', tags: ['search'] },
])(
  'loads matching tools without waiting for viewport entry for search=$keywords and tags=$tags',
  async ({ keywords, tags }) => {
    const screen = await renderPanel(keywords, tags, true)
    await expect.element(screen.getByText('Weather Tool', { exact: true })).toBeInTheDocument()
    expect(requests.search).toHaveBeenCalledWith(
      '/plugins/search/advanced',
      expect.objectContaining({
        body: expect.objectContaining({ query: keywords, tags, category: 'tool' }),
      }),
    )
    expect(requests.collections).not.toHaveBeenCalled()
  },
)

it('scrolls the catalog into view from the real marketplace arrow', async () => {
  const screen = await renderPanel('', [], true)
  const tools = screen.getByRole('region', { name: 'Tools' })
  // Scroll enough to reach the sticky arrow while the catalog heading is still below the viewport.
  tools.element().scrollTo({ top: 700 })
  const arrow = screen.getByRole('button', { name: 'plugin.marketplace.moreFrom' })
  await arrow.click()
  await expect.element(screen.getByText('Weather Tool', { exact: true })).toBeVisible()
  await expect.poll(() => tools.element().scrollTop).toBeGreaterThan(700)
  const heading = screen.getByText('plugin.marketplace.moreFrom', { exact: true })
  const bounds = tools.element().getBoundingClientRect()
  await expect
    .poll(() => heading.element().getBoundingClientRect().top)
    .toBeGreaterThanOrEqual(bounds.top)
  expect(heading.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom)
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
