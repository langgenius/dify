import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { marketplaceLinks } from '@/features/marketplace/links'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Marketplace from '../index'

const requests = vi.hoisted(() => ({ push: vi.fn() }))
// boundary: Next routing is unavailable in the standalone browser page.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: requests.push }) }))
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
      'workspaces.current.plugin.list.installations.ids.post': () => ({ plugins: [] }),
    }),
  }
})
async function renderMarketplaceOwner(ui: React.ReactElement, canInstall = true) {
  const { wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: canInstall ? ['plugin.install'] : [],
    systemFeatures: { rbac_enabled: true },
  })
  const { wrapper: UrlState } = createNuqsTestWrapper()
  return render(
    <Providers>
      <UrlState>{ui}</UrlState>
    </Providers>,
  )
}

beforeEach(async () => {
  await page.viewport(1280, 800)
})

type Props = ComponentProps<typeof Marketplace>
const plugin = createMarketplacePluginFixture({ label: { en_US: 'Search Tool' }, tags: [] })
const collection: MarketplaceCollection = {
  name: 'featured',
  label: { en_US: 'Featured tools' },
  description: { en_US: 'Recommended tools' },
  rule: '',
  created_at: '',
  updated_at: '',
  searchable: true,
  search_params: { query: 'featured tools', sort_by: 'install_count', sort_order: 'DESC' },
}
const context = (
  overrides: Partial<Props['marketplaceContext']> = {},
): Props['marketplaceContext'] => ({
  isLoading: false,
  marketplaceCollections: [],
  marketplaceCollectionPluginsMap: {},
  plugins: [plugin],
  handleScroll: () => {},
  page: 1,
  ...overrides,
})
function renderMarketplace(props: Partial<Props> = {}, canInstall = true) {
  return renderMarketplaceOwner(
    <Marketplace
      marketplace={marketplaceLinks}
      searchPluginText=""
      filterPluginTags={[]}
      isMarketplaceArrowVisible={false}
      showMarketplacePanel={() => {}}
      marketplaceContext={context()}
      {...props}
    />,
    canInstall,
  )
}
it.each([true, false])(
  'keeps the tool visible with installation permission %s',
  async (canInstall) => {
    const screen = await renderMarketplace({}, canInstall)
    await expect.element(screen.getByText('Search Tool', { exact: true })).toBeVisible()
    const install = screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' })
    if (canInstall) await expect.element(install).toBeEnabled()
    else await expect.element(install).not.toBeInTheDocument()
  },
)
it('opens the caller panel and exposes a marketplace link with the current filters', async () => {
  function Caller() {
    const [open, setOpen] = useState(false)
    return (
      <>
        {open && <section aria-label="Marketplace panel">Expanded marketplace</section>}
        <Marketplace
          marketplace={marketplaceLinks}
          searchPluginText="vector"
          filterPluginTags={['tag-a', 'tag-b']}
          isMarketplaceArrowVisible
          showMarketplacePanel={() => setOpen(true)}
          marketplaceContext={context()}
        />
      </>
    )
  }
  const screen = await renderMarketplaceOwner(<Caller />)
  await userEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.moreFrom' }))
  await expect.element(screen.getByRole('region', { name: 'Marketplace panel' })).toBeVisible()
  const link = screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' })
  const url = new URL(link.element().getAttribute('href')!, window.location.origin)
  expect(url.searchParams.get('q')).toBe('vector')
  expect(url.searchParams.get('tags')).toBe('tag-a,tag-b')
  expect(url.searchParams.get('language')).toBe('en-US')
})
it('navigates to the collection search with its filters', async () => {
  const screen = await renderMarketplace({
    marketplaceContext: context({
      plugins: undefined,
      marketplaceCollections: [collection],
      marketplaceCollectionPluginsMap: { featured: [plugin] },
    }),
  })
  await userEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }))
  expect(requests.push).toHaveBeenCalledWith(
    '/marketplace?category=tool&q=featured+tools&sort_by=install_count&sort_order=DESC',
  )
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
