import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { PluginsFromMarketplaceResponse } from '@dify/contracts/marketplace'
import type { ComponentProps } from 'react'
import type { consoleClient } from '@/service/console'
import type { marketplaceClient } from '@/service/marketplace'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { zPluginCategoryInstalledPluginResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import ReadmePanel from '@/app/components/plugins/readme-panel'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createMarketplacePluginFixture, createPluginEntity } from '@/test/fixtures/plugin'
import DataSourcePage from '../index'

const api = vi.hoisted(() => ({
  sources: vi.fn<typeof consoleClient.auth.plugin.datasource.list.get>(),
  installed: vi.fn<typeof consoleClient.workspaces.current.plugin.byCategory.list.get>(),
  uninstall: vi.fn<typeof consoleClient.workspaces.current.plugin.uninstall.post>(),
  readme: vi.fn<typeof consoleClient.workspaces.current.plugin.readme.get>(),
  collection: vi.fn<typeof marketplaceClient.collectionPlugins>(),
  search:
    vi.fn<
      (
        _url: string,
        options: { body?: unknown },
      ) => Promise<{ data: PluginsFromMarketplaceResponse }>
    >(),
}))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: api.search,
}))
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: { ...actual.marketplaceClient, collectionPlugins: api.collection },
  }
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.uninstall.post': api.uninstall,
      'auth.plugin.datasource.list.get': api.sources,
      'workspaces.current.plugin.readme.get': api.readme,
      'workspaces.current.plugin.byCategory.list.get': api.installed,
      'workspaces.current.plugin.list.latestVersions.post': async () => ({ versions: {} }),
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.autoUpgrade.fetch.get': async () => ({
        category: 'datasource',
        auto_upgrade: {
          strategy_setting: 'disabled',
          upgrade_mode: 'all',
          upgrade_time_of_day: 0,
          include_plugins: [],
          exclude_plugins: [],
        },
      }),
    }),
  }
})

const providers = ['Dify', 'Partner'].map((name, index) => ({
  author: name,
  provider: name.toLowerCase(),
  plugin_id: `plugin-${index + 1}`,
  plugin_unique_identifier: `plugin-${index + 1}:1.0.0@test`,
  icon: 'icon.svg',
  name: `${name} Source`,
  label: { en_US: `${name} Source` },
  description: { en_US: `${name} Description` },
  credential_schema: [],
  oauth_schema: null,
  credentials_list: [],
})) satisfies DatasourceProviderAuthResponse[]
const installedPlugin = zPluginCategoryInstalledPluginResponse.parse({
  ...createPluginEntity(),
  name: 'datasource-plugin',
  installation_id: 'plugin-entity-id',
  plugin_id: 'plugin-1',
  plugin_unique_identifier: providers[0]!.plugin_unique_identifier,
  declaration: {
    ...createPluginEntity().declaration,
    category: 'datasource',
    label: { en_US: 'Dify Source' },
  },
})
const recommendation = createMarketplacePluginFixture({
  plugin_id: 'recommendation',
  name: 'recommendation',
  label: { 'en-US': 'Recommended Source' },
  category: PluginCategoryEnum.datasource,
})
const collectionResult = { data: { plugins: [recommendation] } }
beforeEach(() => {
  api.sources.mockReset().mockResolvedValue({ result: providers })
  api.installed.mockReset().mockResolvedValue({ plugins: [], has_more: false, builtin_tools: [] })
  api.uninstall.mockReset().mockResolvedValue({ success: true })
  api.readme.mockReset().mockResolvedValue({ readme: '# Datasource setup guide' })
  api.collection.mockReset().mockResolvedValue(collectionResult)
  api.search.mockReset().mockResolvedValue({ data: { plugins: [recommendation], total: 1 } })
})
afterEach(() => act(() => toast.dismiss()))

function setup(
  options: ConsoleQueryTestOptions = {},
  props: ComponentProps<typeof DataSourcePage> = {},
) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  renderWithConsoleQuery(
    <ThemeProvider defaultTheme="light" enableSystem={false}>
      <NuqsTestingAdapter>
        <DataSourcePage {...props} />
        <ReadmePanel />
        <AppToaster />
      </NuqsTestingAdapter>
    </ThemeProvider>,
    {
      queryClient,
      workspacePermissionKeys: [
        'plugin.plugin_preferences',
        'plugin.install',
        'plugin.delete',
        'credential.use',
      ],
      systemFeatures: { enable_marketplace: false, rbac_enabled: true },
      ...options,
    },
  )
  return { queryClient, user: userEvent.setup() }
}
const marketplaceToggle = () =>
  screen.getByRole('button', { name: 'modelProvider.modelProvider.installDataSource' })

it.each([false, true])(
  'shows the empty-state guidance with marketplace enabled=%s',
  async (enableMarketplace) => {
    api.sources.mockResolvedValue({ result: [] })
    const { user } = setup(
      { systemFeatures: { enable_marketplace: enableMarketplace } },
      { stickyToolbar: true },
    )
    expect(await screen.findByText('common.dataSourcePage.installFirst')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
    if (enableMarketplace) {
      expect(await screen.findByText('Recommended Source')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' })
      const url = new URL(link.getAttribute('href')!, window.location.href)
      expect(url.pathname).toBe('/plugins/datasource')
      expect(url.searchParams.get('theme')).toBe('light')
    } else {
      expect(
        screen.queryByRole('button', { name: 'modelProvider.modelProvider.installDataSource' }),
      ).not.toBeInTheDocument()
      expect(api.search).not.toHaveBeenCalled()
    }
    await user.click(screen.getByRole('button', { name: /plugin.autoUpdate.autoUpdate/ }))
    expect(
      await screen.findByRole('dialog', { name: 'plugin.autoUpdate.autoUpdateSettings' }),
    ).toBeInTheDocument()
  },
)

it('replaces the initial loading state with actual datasource cards', async () => {
  const response = createDeferred<Awaited<ReturnType<typeof api.sources>>>()
  api.sources.mockReturnValueOnce(response.promise)
  setup()
  expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  expect(screen.queryByText('common.dataSourcePage.installFirst')).not.toBeInTheDocument()
  await act(async () => response.resolve({ result: providers }))
  expect(await screen.findByRole('heading', { name: 'Dify Source' })).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
})

it('filters installed sources, announces result counts, and restores them when search clears', async () => {
  const { user } = setup()
  await screen.findByRole('heading', { name: 'Dify Source' })
  const search = screen.getByRole('searchbox')
  await user.type(search, 'partner')
  expect(screen.queryByRole('heading', { name: 'Dify Source' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Partner Source' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    'plugin.category.datasources: plugin.marketplace.pluginsResult:{"num":1}',
  )
  await user.clear(search)
  await user.type(search, 'missing')
  expect(screen.getByRole('status')).toHaveTextContent(
    'plugin.category.datasources: plugin.marketplace.pluginsResult:{"num":0}',
  )
  await user.clear(search)
  expect(screen.getByRole('heading', { name: 'Dify Source' })).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('combines recommendations without installed plugins or duplicates and sends datasource searches to the marketplace', async () => {
  api.search.mockResolvedValue({
    data: {
      plugins: [
        recommendation,
        createMarketplacePluginFixture({
          type: 'bundle',
          plugin_id: 'bundle',
          name: 'bundle',
          label: { 'en-US': 'Plugin Bundle' },
        }),
      ],
      total: 2,
    },
  })
  api.collection.mockResolvedValue({
    data: {
      plugins: [
        createMarketplacePluginFixture({
          plugin_id: 'plugin-1',
          label: { 'en-US': 'Already Installed' },
        }),
        recommendation,
      ],
    },
  })
  const { user } = setup({ systemFeatures: { enable_marketplace: true } })
  expect(await screen.findByText('Recommended Source')).toBeInTheDocument()
  expect(screen.getAllByText('Recommended Source')).toHaveLength(1)
  expect(screen.queryByText('Already Installed')).not.toBeInTheDocument()
  expect(screen.queryByText('Plugin Bundle')).not.toBeInTheDocument()
  await waitFor(() =>
    expect(api.search).toHaveBeenCalledWith(
      '/plugins/search/advanced',
      expect.objectContaining({
        body: expect.objectContaining({
          query: '',
          category: 'datasource',
          exclude: ['plugin-1', 'plugin-2'],
          page_size: 1000,
        }),
      }),
    ),
  )
  await user.type(screen.getByRole('searchbox'), 'partner')
  await waitFor(() =>
    expect(api.search).toHaveBeenLastCalledWith(
      '/plugins/search/advanced',
      expect.objectContaining({
        body: expect.objectContaining({
          query: 'partner',
          category: 'datasource',
          exclude: ['plugin-1', 'plugin-2'],
        }),
      }),
    ),
  )
  expect(
    screen
      .getAllByRole('status')
      .some(
        (status) =>
          status.textContent ===
          'modelProvider.modelProvider.installDataSource: plugin.marketplace.pluginsResult:{"num":1}',
      ),
  ).toBe(true)
  await user.click(marketplaceToggle())
  expect(marketplaceToggle()).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Recommended Source')).not.toBeInTheDocument()
  await user.click(marketplaceToggle())
  expect(screen.getByText('Recommended Source')).toBeInTheDocument()
})

it.each(['collection', 'search'] as const)(
  'keeps recommendations loading until the %s request completes and hides loading when collapsed',
  async (boundary) => {
    const response = createDeferred<{
      data: { plugins: (typeof recommendation)[]; total: number }
    }>()
    if (boundary === 'collection') api.collection.mockReturnValueOnce(response.promise)
    else api.search.mockReturnValueOnce(response.promise)
    const { user } = setup({ systemFeatures: { enable_marketplace: true } })
    await screen.findByRole('heading', { name: 'Dify Source' })
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await user.click(marketplaceToggle())
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await act(async () => response.resolve({ data: { plugins: [recommendation], total: 1 } }))
    await user.click(marketplaceToggle())
    expect(await screen.findByText('Recommended Source')).toBeInTheDocument()
  },
)

it('opens the embedded marketplace through the supplied action', async () => {
  const onOpenMarketplace = vi.fn()
  const { user } = setup({ systemFeatures: { enable_marketplace: true } }, { onOpenMarketplace })
  await user.click(
    await screen.findByRole('button', { name: 'plugin.marketplace.difyMarketplace' }),
  )
  expect(onOpenMarketplace).toHaveBeenCalledOnce()
  expect(
    screen.queryByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
  ).not.toBeInTheDocument()
})

it('refreshes installed sources and the pipeline catalog after removing a plugin from its real menu', async () => {
  api.installed.mockResolvedValue({
    plugins: [installedPlugin],
    has_more: false,
    builtin_tools: [],
  })
  const { user, queryClient } = setup()
  await user.click(
    await screen.findByRole('button', {
      name: 'common.operation.moreActionsFor:{"name":"Dify Source"}',
    }),
  )
  await user.click(
    await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
  )
  const dialog = await screen.findByRole('alertdialog', { name: 'plugin.action.delete' })
  const catalogKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
  queryClient.setQueryData(catalogKey, [])
  api.uninstall.mockImplementationOnce(async () => {
    api.sources.mockResolvedValue({ result: [providers[1]!] })
    api.installed.mockResolvedValue({ plugins: [], has_more: false, builtin_tools: [] })
    return { success: true }
  })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.uninstall).toHaveBeenCalledExactlyOnceWith({
      body: { plugin_installation_id: installedPlugin.id, preserve_credentials: false },
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Dify Source' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('heading', { name: 'Partner Source' })).toBeInTheDocument()
  expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true)
  expect(api.installed).toHaveBeenLastCalledWith({
    params: { category: 'datasource' },
    query: { page: 1, page_size: 100 },
  })
})

it('identifies the installed version and opens that plugin documentation from the card menu', async () => {
  api.installed.mockResolvedValue({
    plugins: [installedPlugin],
    has_more: false,
    builtin_tools: [],
  })
  const { user } = setup()
  expect(
    await screen.findByRole('button', {
      name: 'plugin.detailPanel.switchVersion Dify Source 1.0.0',
    }),
  ).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'common.operation.moreActionsFor:{"name":"Dify Source"}' }),
  )
  await user.click(
    await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.viewReadme' }),
  )
  expect(await screen.findByRole('heading', { name: 'Datasource setup guide' })).toBeInTheDocument()
  expect(api.readme).toHaveBeenCalledWith({
    query: {
      plugin_unique_identifier: installedPlugin.plugin_unique_identifier,
      language: 'en_US',
    },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Datasource setup guide' }),
    ).not.toBeInTheDocument(),
  )
})
