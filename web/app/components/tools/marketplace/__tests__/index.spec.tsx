import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import Marketplace from '../index'

const requests = vi.hoisted(() => ({ push: vi.fn() }))
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
const render = createNuqsTestRenderer(renderWithConsoleQuery)

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
  return render(
    <Marketplace
      searchPluginText=""
      filterPluginTags={[]}
      isMarketplaceArrowVisible={false}
      showMarketplacePanel={() => {}}
      marketplaceContext={context()}
      {...props}
    />,
    {
      workspacePermissionKeys: canInstall ? ['plugin.install'] : [],
      systemFeatures: { rbac_enabled: true },
    },
  )
}
it('shows loading in place of plugin cards while the first page is pending', () => {
  renderMarketplace({ marketplaceContext: context({ isLoading: true }) })
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
  expect(screen.queryByText('Search Tool')).not.toBeInTheDocument()
})
it('renders the plugin and its install action for an allowed workspace', async () => {
  renderMarketplace()
  expect(await screen.findByText('Search Tool')).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: 'plugin.detailPanel.operation.install' }),
  ).toBeEnabled()
})
it('keeps the plugin visible but removes install actions without installation permission', async () => {
  renderMarketplace({}, false)
  expect(await screen.findByText('Search Tool')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'plugin.detailPanel.operation.install' }),
  ).not.toBeInTheDocument()
})
it('opens the caller panel and exposes a marketplace link with the current filters', async () => {
  const user = userEvent.setup()
  function Caller() {
    const [open, setOpen] = useState(false)
    return (
      <>
        {open && <section aria-label="Marketplace panel">Expanded marketplace</section>}
        <Marketplace
          searchPluginText="vector"
          filterPluginTags={['tag-a', 'tag-b']}
          isMarketplaceArrowVisible
          showMarketplacePanel={() => setOpen(true)}
          marketplaceContext={context()}
        />
      </>
    )
  }
  render(<Caller />, {
    workspacePermissionKeys: ['plugin.install'],
    systemFeatures: { rbac_enabled: true },
  })
  await user.click(screen.getByRole('button', { name: 'plugin.marketplace.moreFrom' }))
  expect(screen.getByRole('region', { name: 'Marketplace panel' })).toBeInTheDocument()
  const link = screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' })
  const url = new URL(link.getAttribute('href')!, window.location.origin)
  expect(url.searchParams.get('q')).toBe('vector')
  expect(url.searchParams.get('tags')).toBe('tag-a,tag-b')
  expect(url.searchParams.get('language')).toBe('en-US')
})
it('opens the integrations marketplace from the real collection more button', async () => {
  const user = userEvent.setup()
  renderMarketplace({
    marketplaceContext: context({
      plugins: undefined,
      marketplaceCollections: [collection],
      marketplaceCollectionPluginsMap: { featured: [plugin] },
    }),
  })
  await user.click(await screen.findByRole('button', { name: 'plugin.marketplace.viewMore' }))
  expect(requests.push).toHaveBeenCalledWith(
    '/marketplace?category=tool&q=featured+tools&sort_by=install_count&sort_order=DESC',
  )
})
