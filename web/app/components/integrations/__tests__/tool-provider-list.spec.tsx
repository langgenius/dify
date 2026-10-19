import type { ComponentProps } from 'react'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { renderWithNuqs } from '@/test/nuqs-testing'
import ProviderList from '../tool-provider-list'

const api = vi.hoisted(() => ({
  createMCP:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.post
    >(),
  authorizeMCP:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.auth.post
    >(),
  updateMCPTools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.update.byProviderId.get
    >(),
  mcpTools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.tools.byProviderId.get
    >(),
  installed:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.list.installations.ids.post
    >(),
  uninstall:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.uninstall.post
    >(),

  providers:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.toolProviders.get>(),
  custom:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.api.get>(),
  workflow:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.workflow.get>(),
  builtinTools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.builtin.byProvider.tools.get
    >(),
  createCustom:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.add.post
    >(),
  parseSchema:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.schema.post
    >(),
  deleteMCP:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.mcp.delete
    >(),
  collections: vi.fn<typeof import('@/service/marketplace').marketplaceClient.collections>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.uninstall.post': api.uninstall,
      'workspaces.current.toolProviders.get': api.providers,
      'workspaces.current.plugin.list.installations.ids.post': api.installed,
      'workspaces.current.toolProvider.builtin.byProvider.tools.get': api.builtinTools,
      'workspaces.current.tools.api.get': api.custom,
      'workspaces.current.tools.workflow.get': api.workflow,
      'workspaces.current.toolProvider.mcp.delete': api.deleteMCP,
      'workspaces.current.toolProvider.mcp.post': api.createMCP,
      'workspaces.current.toolProvider.mcp.auth.post': api.authorizeMCP,
      'workspaces.current.toolProvider.mcp.update.byProviderId.get': api.updateMCPTools,
      'workspaces.current.toolProvider.mcp.tools.byProviderId.get': api.mcpTools,
      'workspaces.current.plugin.installedIds.get': async () => ({ plugin_ids: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.toolProvider.builtin.byProvider.tools.get': api.builtinTools,
      'workspaces.current.toolProvider.api.add.post': api.createCustom,
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.toolProvider.api.schema.post': api.parseSchema,
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.autoUpgrade.fetch.get': async () => ({
        category: 'tool',
        auto_upgrade: {
          strategy_setting: 'fix_only',
          upgrade_time_of_day: 0,
          upgrade_mode: 'all',
          exclude_plugins: [],
          include_plugins: [],
        },
      }),
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: { ...actual.marketplaceClient, collections: api.collections },
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: async (url: string) => {
    if (url === '/remote-files/upload')
      return {
        id: 'favicon',
        name: 'favicon.png',
        size: 10,
        mime_type: 'image/png',
        url: '/favicon.png',
      }
    throw new Error(`Unexpected service request: ${url}`)
  },
  get: async (url: string) => {
    if (
      url ===
      '/workspaces/current/tool-provider/builtin/langgenius/plugin-entity/plugin-entity/credential/info'
    )
      return {
        supported_credential_types: [],
        credentials: [],
        is_oauth_custom_client_enabled: false,
      }
    throw new Error(`Unexpected service request: ${url}`)
  },
}))

const pluginEntity = createPluginEntity()
pluginEntity.declaration.tool = {
  credentials_schema: [],
  identity: {
    author: 'Dify',
    name: 'plugin-entity',
    icon: 'icon.svg',
    label: { en_US: 'Plugin label' },
    description: { en_US: 'Plugin description' },
  },
}
const pluginProvider = createToolProviderFixture({
  id: 'plugin-provider',
  name: 'langgenius/plugin-entity/plugin-entity',
  label: { en_US: 'Installed Plugin' },
  plugin_id: pluginEntity.plugin_id,
})

const builtin = [
  createToolProviderFixture({
    id: 'google',
    name: 'google-search',
    label: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    description: { en_US: 'Search the web' },
    labels: ['search'],
    allow_delete: false,
  }),
  createToolProviderFixture({
    id: 'weather',
    name: 'weather-tool',
    label: { en_US: 'Weather Tool' },
    description: { en_US: 'Weather forecast' },
    labels: ['utilities'],
    allow_delete: false,
  }),
]
const custom = createToolProviderFixture({
  id: 'custom',
  name: 'my-api',
  type: 'api',
  label: { en_US: 'My API Tool' },
  author: 'Custom Author',
  labels: ['api'],
})
const workflow = createToolProviderFixture({
  id: 'workflow',
  name: 'workflow-tool',
  type: 'workflow',
  label: { en_US: 'Workflow Tool' },
  author: 'Workflow Author',
  labels: ['productivity'],
})
const mcp = createToolProviderFixture({
  id: 'mcp-database-id',
  name: 'MCP Server',
  type: 'mcp',
  server_identifier: 'mcp-server',
  label: { en_US: 'MCP Server' },
  server_url: 'https://mcp.example.com',
})

type RenderOptions = {
  category?: ComponentProps<typeof ProviderList>['category']
  searchParams?: Record<string, string>
  permissions?: string[]
  providers?: typeof builtin
  customTools?: typeof builtin
  workflowTools?: typeof builtin
  pending?: boolean
  marketplace?: boolean
}
const renderProviderList = ({
  category,
  searchParams,
  permissions = ['tool.manage', 'mcp.manage'],
  providers = builtin,
  customTools = [custom],
  workflowTools = [workflow],
  pending = false,
  marketplace = false,
}: RenderOptions = {}) => {
  const { wrapper: Wrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
    systemFeatures: { enable_marketplace: marketplace, rbac_enabled: true },
  })
  seedModelProviderQueries(queryClient)
  if (!pending) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProviders.get.queryKey({ input: { query: {} } }),
      providers,
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProviders.get.queryKey({
        input: { query: { type: 'mcp' } },
      }),
      providers.filter((item) => item.type === 'mcp'),
    )
    queryClient.setQueryData(consoleQuery.workspaces.current.tools.api.get.queryKey(), customTools)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.tools.workflow.get.queryKey(),
      workflowTools,
    )
  }
  return renderWithNuqs(
    <Wrapper>
      <ProviderList category={category} contentInset="compact" />
    </Wrapper>,
    { searchParams },
  )
}

beforeEach(() => {
  api.createMCP.mockReset().mockResolvedValue(mcp)
  api.authorizeMCP.mockReset().mockResolvedValue({ result: 'success' })
  api.updateMCPTools.mockReset().mockResolvedValue(mcp)
  api.mcpTools.mockReset().mockResolvedValue(mcp)
  api.installed.mockReset().mockResolvedValue({ plugins: [pluginEntity] })
  api.uninstall.mockReset().mockResolvedValue({ success: true })
  api.providers.mockReset().mockResolvedValue(builtin)
  api.custom.mockReset().mockResolvedValue([custom])
  api.workflow.mockReset().mockResolvedValue([workflow])
  api.builtinTools.mockReset().mockResolvedValue([])
  api.createCustom.mockReset().mockResolvedValue({ result: 'success' })
  api.parseSchema.mockReset().mockResolvedValue({
    parameters_schema: [],
    credentials_schema: [],
    warning: {},
    schema_type: 'openapi',
  })
  api.deleteMCP.mockReset().mockResolvedValue({ result: 'success' })
  api.collections.mockReset().mockResolvedValue({ data: { collections: [] } })
})
afterEach(async () => {
  await act(async () => cleanup())
})

it('lets read-only users browse every category and synchronizes the selected category to the URL', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderProviderList({ permissions: [], providers: [...builtin, mcp] })
  expect(screen.getByRole('radio', { name: 'tools.type.builtIn' })).toBeChecked()
  expect(screen.getByRole('button', { name: /Google Search/ })).toBeInTheDocument()
  for (const [tab, label, category] of [
    ['tools.type.custom', 'My API Tool', 'api'],
    ['tools.type.workflow', 'Workflow Tool', 'workflow'],
    ['MCP', 'MCP Server', 'mcp'],
  ] as const) {
    await user.click(screen.getByRole('radio', { name: tab }))
    expect(await screen.findByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: `?category=${category}` }),
      ),
    )
    expect(
      screen.queryByRole('button', {
        name: /tools\.(addSwaggerAPIAsTool|createSwaggerAPIAsTool|mcp.create.cardTitle)/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.tag.tags' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /plugin.autoUpdate.autoUpdate/ }),
    ).not.toBeInTheDocument()
  }
  expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
})

it('uses the route category instead of a conflicting query parameter', () => {
  renderProviderList({ category: 'workflow', searchParams: { category: 'api' } })
  expect(screen.getByRole('button', { name: /Workflow Tool/ })).toHaveTextContent('Workflow Author')
  expect(screen.getByRole('button', { name: /Workflow Tool/ })).toHaveTextContent('productivity')
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /My API Tool/ })).not.toBeInTheDocument()
})

it('matches localized labels within the category and restores the list when search is cleared', async () => {
  const user = userEvent.setup()
  renderProviderList({ category: 'builtin' })
  await user.type(screen.getByRole('searchbox'), '谷歌')
  expect(screen.getByRole('button', { name: /Google Search/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Weather Tool/ })).not.toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox'))
  await user.type(screen.getByRole('searchbox'), 'My API')
  expect(
    screen.queryByRole('button', { name: /Google Search|My API Tool/ }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('tools.noTools')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(screen.getByRole('button', { name: /Weather Tool/ })).toBeInTheDocument()
})

it('applies and clears builtin tags without filtering other categories', async () => {
  const user = userEvent.setup()
  renderProviderList()
  await user.click(screen.getByRole('button', { name: 'common.tag.tags' }))
  await user.click(await screen.findByRole('button', { name: 'pluginTags.tags.search' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('button', { name: /Weather Tool/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'tools.type.custom' }))
  expect(screen.getByRole('button', { name: /My API Tool/ })).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'tools.type.builtIn' }))
  expect(screen.queryByRole('button', { name: /Weather Tool/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(screen.getByRole('button', { name: /Weather Tool/ })).toBeInTheDocument()
})

it('opens the builtin provider details and clears selection when changing categories', async () => {
  const user = userEvent.setup()
  renderProviderList()
  await user.click(screen.getByRole('button', { name: /Google Search/ }))
  const detail = await screen.findByRole('dialog')
  expect(within(detail).getByText('Google Search')).toBeInTheDocument()
  await waitFor(() =>
    expect(api.builtinTools).toHaveBeenCalledWith({ params: { provider: 'google-search' } }),
  )
  await user.click(screen.getByRole('radio', { name: 'tools.type.builtIn' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'tools.type.custom' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('radio', { name: 'tools.type.builtIn' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('closes provider details from its close control', async () => {
  const user = userEvent.setup()
  renderProviderList()
  await user.click(screen.getByRole('button', { name: /Google Search/ }))
  const detail = await screen.findByRole('dialog')
  await user.click(within(detail).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /Google Search/ })).not.toHaveAttribute('aria-current')
})

it('waits for the builtin catalog before showing the empty state', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof api.providers>>>()
  api.providers.mockReturnValue(request.promise)
  renderProviderList({ pending: true })
  expect(screen.queryByText('tools.noTools')).not.toBeInTheDocument()
  await act(async () => request.resolve([]))
  expect(await screen.findByText('tools.noTools')).toBeInTheDocument()
})

it('distinguishes an empty workflow catalog from a search with no matches', async () => {
  const user = userEvent.setup()
  const { unmount } = renderProviderList({ category: 'workflow', workflowTools: [] })
  expect(screen.getByRole('link', { name: /tools.workflowToolEmpty.goToStudio/ })).toHaveAttribute(
    'href',
    '/apps',
  )
  unmount()
  renderProviderList({ category: 'workflow' })
  await user.type(screen.getByRole('searchbox'), 'not-found')
  expect(screen.queryByRole('button', { name: /Workflow Tool/ })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: /tools.workflowToolEmpty.goToStudio/ }),
  ).not.toBeInTheDocument()
})

it.each([
  { initial: [], entry: 'tools.createSwaggerAPIAsTool' },
  { initial: [custom], entry: 'tools.addSwaggerAPIAsTool' },
])('creates a custom tool through $entry and refreshes the catalog', async ({ initial, entry }) => {
  const user = userEvent.setup()
  const created = createToolProviderFixture({
    id: 'created',
    name: 'New Collection',
    type: 'api',
    label: { en_US: 'New Collection' },
  })
  api.custom.mockResolvedValue([...initial, created])
  renderProviderList({ category: 'api', customTools: initial })
  await user.click(screen.getByRole('button', { name: entry }))
  const drawer = await screen.findByRole('dialog', { name: 'tools.createTool.title' })
  await user.type(
    within(drawer).getByRole('textbox', { name: /tools.createTool.name/ }),
    'New Collection',
  )
  const schema = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Weather', version: '1.0.0' },
    servers: [{ url: 'https://weather.example.com' }],
    paths: {},
  })
  await user.click(within(drawer).getByPlaceholderText('tools.createTool.schemaPlaceHolder'))
  await user.paste(schema)
  await waitFor(() => expect(api.parseSchema).toHaveBeenCalledWith({ body: { schema } }))
  await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(api.createCustom).toHaveBeenCalledWith({
      body: expect.objectContaining({
        provider: 'New Collection',
        schema,
        schema_type: 'openapi',
        credentials: { auth_type: 'none' },
      }),
    }),
  )
  expect(await screen.findByRole('button', { name: /New Collection/ })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'tools.createSwaggerAPIAsTool' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'tools.addSwaggerAPIAsTool' })).toBeInTheDocument()
})

it.each([
  { state: 'empty', providers: [] },
  { state: 'populated', providers: [mcp] },
])('creates and authorizes an MCP provider from the $state catalog', async ({ providers }) => {
  const user = userEvent.setup()
  const created = createToolProviderFixture({
    ...mcp,
    id: 'created-mcp-id',
    name: 'New MCP',
    server_identifier: 'new-mcp',
    server_url: 'https://new.example.com',
  })
  const connected = createToolProviderFixture({ ...created, is_team_authorization: true })
  api.createMCP.mockResolvedValue(created)
  api.providers.mockResolvedValue([...providers, created])
  api.updateMCPTools.mockImplementation(async () => {
    api.providers.mockResolvedValue([...providers, connected])
    return connected
  })
  api.mcpTools.mockResolvedValue(connected)
  renderProviderList({ searchParams: { category: 'mcp' }, providers })
  await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
  const form = await screen.findByRole('dialog', { name: 'tools.mcp.modal.title' })
  await user.type(
    within(form).getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' }),
    'https://new.example.com',
  )
  await user.type(within(form).getByRole('textbox', { name: 'tools.mcp.modal.name' }), 'New MCP')
  await user.type(
    within(form).getByRole('textbox', { name: 'tools.mcp.modal.serverIdentifier' }),
    'new-mcp',
  )
  await waitFor(() =>
    expect(within(form).getByRole('button', { name: 'tools.mcp.modal.confirm' })).toBeEnabled(),
  )
  await user.click(within(form).getByRole('button', { name: 'tools.mcp.modal.confirm' }))
  await waitFor(() =>
    expect(api.createMCP).toHaveBeenCalledWith({
      body: expect.objectContaining({
        name: 'New MCP',
        server_url: 'https://new.example.com',
        server_identifier: 'new-mcp',
      }),
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'tools.mcp.modal.title' })).not.toBeInTheDocument(),
  )
  const detail = await screen.findByRole('dialog')
  expect(within(detail).getByText('New MCP')).toBeInTheDocument()
  expect(
    await within(detail).findByRole('button', { name: 'tools.auth.authorized' }),
  ).toBeInTheDocument()
  expect(api.authorizeMCP).toHaveBeenCalledExactlyOnceWith({
    body: { provider_id: 'created-mcp-id' },
  })
  await user.click(within(detail).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /New MCP/ }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(api.authorizeMCP).toHaveBeenCalledTimes(1)
})

it('discards an unfinished MCP creation when cancelled and keeps the documentation link available', async () => {
  const user = userEvent.setup()
  renderProviderList({ searchParams: { category: 'mcp' }, providers: [] })
  expect(screen.getByRole('link', { name: 'tools.mcp.create.cardLink' })).toHaveAttribute(
    'href',
    expect.stringContaining('/workspace/tools#mcp'),
  )
  await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
  let form = await screen.findByRole('dialog', { name: 'tools.mcp.modal.title' })
  await user.type(within(form).getByRole('textbox', { name: 'tools.mcp.modal.name' }), 'Unfinished')
  await user.click(within(form).getByRole('button', { name: 'tools.mcp.modal.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
  form = await screen.findByRole('dialog', { name: 'tools.mcp.modal.title' })
  expect(within(form).getByRole('textbox', { name: 'tools.mcp.modal.name' })).toHaveValue('')
  expect(api.createMCP).not.toHaveBeenCalled()
})

it('deletes an MCP provider using its database id and removes it after refresh', async () => {
  const user = userEvent.setup()
  api.providers.mockResolvedValue([])
  renderProviderList({ category: 'mcp', providers: [mcp] })
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'tools.mcp.operation.remove' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'tools.mcp.delete' })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.deleteMCP).toHaveBeenCalledWith({ body: { provider_id: 'mcp-database-id' } }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /MCP Server/ })).not.toBeInTheDocument(),
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('allows plugin preferences from the builtin toolbar with the matching permission', async () => {
  const user = userEvent.setup()
  renderProviderList({ category: 'builtin', permissions: ['plugin.plugin_preferences'] })
  await user.click(screen.getByRole('button', { name: /plugin.autoUpdate.autoUpdate/ }))
  const dialog = await screen.findByRole('dialog', { name: 'plugin.autoUpdate.autoUpdateSettings' })
  expect(
    await within(dialog).findByText('plugin.autoUpdate.strategy.fixOnly.name'),
  ).toBeInTheDocument()
})

it.each([
  { category: 'builtin', permissions: [] },
  { category: 'api', permissions: ['plugin.plugin_preferences'] },
] as const)(
  'does not offer plugin settings for $category with $permissions',
  ({ category, permissions }) => {
    renderProviderList({ category, permissions: [...permissions] })
    expect(
      screen.queryByRole('button', { name: /plugin.autoUpdate.autoUpdate/ }),
    ).not.toBeInTheDocument()
  },
)

it.each([
  { category: 'builtin', marketplace: false },
  { category: 'api', marketplace: true },
] as const)(
  'does not load marketplace for $category when enabled=$marketplace',
  async (options) => {
    renderProviderList(options)
    await act(async () => {})
    expect(screen.queryByText('plugin.marketplace.moreFrom')).not.toBeInTheDocument()
    expect(api.collections).not.toHaveBeenCalled()
  },
)

it('loads the tool marketplace when the user expands it', async () => {
  const user = userEvent.setup()
  renderProviderList({ marketplace: true })
  await user.click(screen.getByRole('button', { name: 'plugin.marketplace.moreFrom' }))
  await waitFor(() =>
    expect(api.collections).toHaveBeenCalledWith(
      { query: expect.objectContaining({ category: 'tool', exclude: [] }) },
      expect.anything(),
    ),
  )
  expect(screen.getByText('plugin.marketplace.moreFrom')).toBeInTheDocument()
})

it('loads an installed plugin detail and closes it without losing the catalog', async () => {
  const user = userEvent.setup()
  renderProviderList({ providers: [pluginProvider], permissions: [] })
  await user.click(screen.getByRole('button', { name: /Installed Plugin/ }))
  const detail = await screen.findByRole('dialog')
  expect(within(detail).getByText('Plugin label')).toBeInTheDocument()
  expect(api.installed).toHaveBeenCalledWith({ body: { plugin_ids: ['langgenius/plugin-entity'] } })
  await user.click(
    within(detail).getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
  )
  expect(
    screen.queryByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
  ).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await user.click(within(detail).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /Installed Plugin/ })).toBeInTheDocument()
})

it('uninstalls a plugin from its real details and refreshes the tool catalog', async () => {
  const user = userEvent.setup()
  api.providers.mockResolvedValue([])
  renderProviderList({ providers: [pluginProvider], permissions: ['plugin.delete'] })
  await user.click(screen.getByRole('button', { name: /Installed Plugin/ }))
  const detail = await screen.findByRole('dialog')
  await user.click(
    within(detail).getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
  )
  await user.click(
    await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
  )
  const confirm = await screen.findByRole('alertdialog', { name: 'plugin.action.delete' })
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.uninstall).toHaveBeenCalledWith({
      body: { plugin_installation_id: pluginEntity.id, preserve_credentials: false },
    }),
  )
  expect(await screen.findByText('tools.noTools')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Installed Plugin/ })).not.toBeInTheDocument()
})

it('discards an unfinished custom tool and links to the API tool documentation', async () => {
  const user = userEvent.setup()
  renderProviderList({ category: 'api', customTools: [] })
  expect(screen.getByRole('link', { name: 'tools.swaggerAPIAsToolTip' })).toHaveAttribute(
    'href',
    expect.stringContaining('/workspace/tools#swagger-api'),
  )
  await user.click(screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' }))
  let form = await screen.findByRole('dialog', { name: 'tools.createTool.title' })
  await user.type(
    within(form).getByRole('textbox', { name: /tools.createTool.name/ }),
    'Unfinished',
  )
  await user.click(within(form).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' }))
  form = await screen.findByRole('dialog', { name: 'tools.createTool.title' })
  expect(within(form).getByRole('textbox', { name: /tools.createTool.name/ })).toHaveValue('')
  expect(api.createCustom).not.toHaveBeenCalled()
})
