import type { ComponentProps, ReactElement } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'
import {
  createProviderSummaryFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture, createPluginEntity } from '@/test/fixtures/plugin'
import { renderWithNuqs } from '@/test/nuqs-testing'
import IntegrationsPage from '../index'

const api = vi.hoisted(() => ({
  push: vi.fn(),
  manifest: vi.fn<typeof import('@/service/plugins').fetchManifestFromMarketPlace>(),
  upload: vi.fn<typeof import('@/service/plugins').uploadFile>(),
  permission:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.permission.fetch.get
    >(),
  savePermission:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.permission.change.post
    >(),
  category:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.byCategory.list.get
    >(),
  autoUpgrade:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.autoUpgrade.fetch.get
    >(),
  saveAutoUpgrade:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.autoUpgrade.change.post
    >(),
  debug:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.plugin.debuggingKey.get
    >(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.byCategory.list.get': api.category,
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
      'workspaces.current.plugin.list.get': async () => ({ plugins: [], total: 0 }),
      'workspaces.current.plugin.installedIds.get': async () => ({ plugin_ids: [] }),
      'auth.plugin.datasource.list.get': async () => ({ result: [] }),
      'apiBasedExtension.get': async () => [],
      'workspaces.current.toolProviders.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': api.permission,
      'workspaces.current.plugin.permission.change.post': api.savePermission,
      'workspaces.current.plugin.autoUpgrade.fetch.get': api.autoUpgrade,
      'workspaces.current.plugin.autoUpgrade.change.post': api.saveAutoUpgrade,
      'workspaces.current.plugin.debuggingKey.get': api.debug,
      'workspaces.current.plugin.marketplace.pkg.get': async () => ({
        manifest: { ...createPluginEntity().declaration, category: PluginCategoryEnum.trigger },
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
    }),
  }
})
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  fetchManifestFromMarketPlace: api.manifest,
  uploadFile: api.upload,
}))
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collectionPlugins: async () => ({ data: { plugins: [] } }),
      collections: async () => ({ data: { collections: [] } }),
    },
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: async (url: string) => {
    if (url === '/plugins/search/advanced') return { data: { plugins: [], total: 0 } }
    throw new Error(`Unexpected marketplace request: ${url}`)
  },
}))

const permissions = [
  'plugin.install',
  'plugin.debug',
  'plugin.plugin_preferences',
  'tool.manage',
  'mcp.manage',
  'api_extension.manage',
]
const models = [
  createProviderSummaryFixture({
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    is_configured: false,
    custom_configuration: { status: 'no-configure' },
  }),
  createProviderSummaryFixture({
    provider: 'anthropic',
    label: { en_US: 'Anthropic' },
    is_configured: false,
    custom_configuration: { status: 'no-configure' },
  }),
]
const defaultUpgrade = {
  strategy_setting: 'fix_only' as const,
  upgrade_time_of_day: 0,
  upgrade_mode: 'all' as const,
  exclude_plugins: [],
  include_plugins: [],
}

beforeEach(() => {
  api.push.mockReset()
  api.manifest.mockReset().mockResolvedValue({
    data: {
      plugin: {
        plugin_unique_identifier: 'test/trigger:1.0.0@package',
        name: 'trigger',
        org: 'test',
        icon: 'icon.svg',
        label: { ...createPluginDeclarationFixture().label, en_US: 'Trigger Package' },
        category: PluginCategoryEnum.trigger,
        version: '1.0.0',
        latest_version: '1.0.0',
        brief: createPluginDeclarationFixture().description,
        introduction: '',
        verified: true,
        install_count: 10,
        badges: [],
        verification: { authorized_category: 'community' },
        from: 'marketplace',
      },
      version: { version: '1.0.0' },
    },
  })
  api.upload.mockReset().mockReturnValue(new Promise(() => {}))
  api.permission
    .mockReset()
    .mockResolvedValue({ install_permission: 'everyone', debug_permission: 'everyone' })
  api.savePermission.mockReset().mockResolvedValue({ success: true })
  api.category.mockReset().mockResolvedValue({ builtin_tools: [], plugins: [], has_more: false })
  api.autoUpgrade.mockReset().mockImplementation(async ({ query }) => ({
    category: query.category,
    auto_upgrade: defaultUpgrade,
  }))
  api.saveAutoUpgrade.mockReset().mockResolvedValue({ success: true })
  api.debug.mockReset().mockResolvedValue({ key: 'test-debug-key', host: 'localhost', port: 5003 })
  vi.spyOn(window, 'open').mockImplementation(() => null)
  document.title = ''
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderPage({
  props = {},
  searchParams = {},
  workspacePermissionKeys = permissions,
  rbacEnabled = true,
  restrictLocalPackages = false,
  ui,
}: {
  props?: ComponentProps<typeof IntegrationsPage>
  searchParams?: Record<string, string>
  workspacePermissionKeys?: string[]
  rbacEnabled?: boolean
  restrictLocalPackages?: boolean
  ui?: ReactElement
} = {}) {
  const { wrapper: QueryProvider, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys,
    systemFeatures: {
      rbac_enabled: rbacEnabled,
      enable_marketplace: true,
      plugin_installation_permission: { restrict_to_marketplace_only: restrictLocalPackages },
    },
  })
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: models,
    plugins: {},
  })
  const renderOwner = (content: ReactElement) => <QueryProvider>{content}</QueryProvider>
  const view = renderWithNuqs(renderOwner(ui ?? <IntegrationsPage {...props} />), {
    searchParams,
    hasMemory: true,
  })
  return {
    ...view,
    queryClient,
    rerender: (content: ReactElement) => view.rerender(renderOwner(content)),
  }
}
function SettingsIntegrations() {
  const [section, setSection] =
    useState<ComponentProps<typeof IntegrationsPage>['section']>('provider')
  return <IntegrationsPage section={section} onSectionChange={setSection} />
}

it('defaults to models and preserves a real model search across section navigation', async () => {
  const user = userEvent.setup()
  renderPage({ ui: <SettingsIntegrations /> })
  expect(screen.getByRole('heading', { name: 'navigation.settings.provider' })).toBeInTheDocument()
  expect(screen.getByText('OpenAI')).toBeInTheDocument()
  expect(screen.getByText('Anthropic')).toBeInTheDocument()
  await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'OpenAI')
  await waitFor(() => expect(screen.queryByText('Anthropic')).not.toBeInTheDocument())
  const navigation = screen.getByRole('navigation', { name: 'navigation.settings.integrations' })
  await user.click(
    within(navigation).getByRole('button', { name: 'navigation.settings.dataSource' }),
  )
  expect(
    screen.getByRole('heading', { name: 'navigation.settings.dataSource' }),
  ).toBeInTheDocument()
  await user.click(within(navigation).getByRole('button', { name: 'navigation.settings.provider' }))
  expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveValue('OpenAI')
  expect(screen.getByText('OpenAI')).toBeInTheDocument()
  expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
})

it('closes compact navigation after changing the settings section', async () => {
  const user = userEvent.setup()
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(width < 48rem)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  renderPage({ ui: <SettingsIntegrations /> })
  await user.click(
    screen.getByRole('button', {
      name: 'navigation.mainNav.integrations: navigation.settings.provider',
    }),
  )
  const drawer = await screen.findByRole('dialog', { name: 'navigation.mainNav.integrations' })
  await user.click(within(drawer).getByRole('button', { name: 'navigation.settings.dataSource' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'navigation.mainNav.integrations' }),
    ).not.toBeInTheDocument(),
  )
  expect(
    screen.getByRole('heading', { name: 'navigation.settings.dataSource' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', {
      name: 'navigation.mainNav.integrations: navigation.settings.dataSource',
    }),
  ).toBeInTheDocument()
})

it('preserves the host title in settings and updates it for route navigation', () => {
  document.title = 'Workspace settings - Dify'
  const view = renderPage()
  expect(document.title).toBe('Workspace settings - Dify')
  view.rerender(<IntegrationsPage section="provider" syncDocumentTitle />)
  expect(document.title).toBe(
    'navigation.settings.provider · navigation.mainNav.integrations - Dify',
  )
  view.rerender(<IntegrationsPage section="data-source" syncDocumentTitle />)
  expect(document.title).toBe(
    'navigation.settings.dataSource · navigation.mainNav.integrations - Dify',
  )
})

it('honors a legacy category-only MCP URL and the explicit route section takes precedence', async () => {
  const user = userEvent.setup()
  const view = renderPage({ searchParams: { category: 'mcp' } })
  expect(screen.getByRole('heading', { name: 'MCP' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute('aria-current', 'page')
  await user.click(await screen.findByRole('button', { name: 'tools.mcp.create.cardTitle' }))
  expect(await screen.findByRole('dialog', { name: 'tools.mcp.modal.title' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.cancel' }))
  view.rerender(<IntegrationsPage section="custom-tool" />)
  expect(
    screen.getByRole('heading', { name: 'navigation.settings.swaggerAPIAsTool' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'navigation.settings.swaggerAPIAsTool' }),
  ).toHaveAttribute('aria-current', 'page')
  expect(
    screen.getByRole('link', { name: 'navigation.settings.swaggerAPIAsTool' }),
  ).toHaveAttribute('href', '/integrations/tools/api')
})

it('keeps tools expanded while visiting models and changes to tools only when opening the disclosure', async () => {
  const user = userEvent.setup()
  renderPage({ ui: <SettingsIntegrations /> })
  const tools = screen.getByRole('button', { name: 'navigation.menus.tools' })
  await user.click(tools)
  expect(
    await screen.findByRole('heading', { name: 'navigation.toolsPage.toolPlugin' }),
  ).toBeInTheDocument()
  expect(tools).toHaveAttribute('aria-expanded', 'true')
  const navigation = screen.getByRole('navigation', { name: 'navigation.settings.integrations' })
  await user.click(within(navigation).getByRole('button', { name: 'navigation.settings.provider' }))
  expect(tools).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('heading', { name: 'navigation.settings.provider' })).toBeInTheDocument()
  await user.click(tools)
  expect(tools).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('heading', { name: 'navigation.settings.provider' })).toBeInTheDocument()
  expect(within(navigation).queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
})

it('opens the built-in tools route from the parent tools disclosure', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(screen.getByRole('button', { name: 'navigation.menus.tools' }))
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/integrations/tools/built-in')
})

it.each([
  ['builtin', 'tool', 'navigation.toolsPage.toolPlugin'],
  ['trigger', 'trigger', 'plugin.categorySingle.trigger'],
  ['extension', 'extension', 'plugin.categorySingle.extension'],
  ['agent-strategy', 'agent-strategy', 'plugin.categorySingle.agent'],
] as const)('loads the %s plugin category from the URL', async (section, category, heading) => {
  renderPage({ searchParams: { section } })
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  await waitFor(() =>
    expect(api.category).toHaveBeenCalledWith(expect.objectContaining({ params: { category } })),
  )
  expect(screen.getByRole('link', { name: heading })).toHaveAttribute('aria-current', 'page')
})

it.each([
  ['provider', '/plugins/model'],
  ['data-source', '/plugins/datasource'],
] as const)('opens the %s marketplace from its actual section action', async (section, path) => {
  const user = userEvent.setup()
  renderPage({ props: { section } })
  const action = 'plugin.marketplace.difyMarketplace'
  await user.click(await screen.findByRole('button', { name: action }))
  expect(window.open).toHaveBeenCalledWith(
    expect.stringContaining(`${path}?source=`),
    '_blank',
    'noopener,noreferrer',
  )
})

it('passes the category marketplace path to the settings host from the install menu', async () => {
  const user = userEvent.setup()
  const onSwitchToMarketplace = vi.fn()
  renderPage({ props: { section: 'trigger', onSwitchToMarketplace } })
  await user.click(await screen.findByRole('button', { name: 'plugin.installAction' }))
  await user.click(screen.getByRole('menuitem', { name: 'plugin.source.marketplace' }))
  expect(onSwitchToMarketplace).toHaveBeenCalledExactlyOnceWith('/plugins/trigger')
  expect(window.open).not.toHaveBeenCalled()
})

it('saves category-specific automatic update settings from the toolbar', async () => {
  const user = userEvent.setup()
  renderPage({ props: { section: 'trigger' } })
  await user.click(await screen.findByRole('button', { name: /plugin.autoUpdate.autoUpdate/ }))
  const dialog = screen.getByRole('dialog', { name: 'plugin.autoUpdate.autoUpdateSettings' })
  await user.click(
    within(dialog).getByRole('radio', { name: 'plugin.autoUpdate.strategy.disabled.name' }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(api.saveAutoUpgrade).toHaveBeenCalledWith({
      body: expect.objectContaining({
        category: 'trigger',
        auto_upgrade: expect.objectContaining({ strategy_setting: 'disabled' }),
      }),
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'plugin.autoUpdate.autoUpdateSettings' }),
    ).not.toBeInTheDocument(),
  )
})

it('shows a real remote debug connection from the sidebar', async () => {
  const user = userEvent.setup()
  renderPage({ props: { section: 'data-source' } })
  await user.click(await screen.findByRole('button', { name: 'plugin.debugInfo.title' }))
  const dialog = screen.getByRole('dialog', { name: 'plugin.debugInfo.title' })
  expect(within(dialog).getByText('localhost:5003')).toBeInTheDocument()
  expect(within(dialog).getByRole('link', { name: 'plugin.debugInfo.viewDocs' })).toHaveAttribute(
    'href',
    expect.stringContaining('remote-debug-a-plugin'),
  )
})

it('hides install, debug, and settings actions for a reader without requesting debug credentials', async () => {
  renderPage({ props: { section: 'trigger' }, workspacePermissionKeys: [] })
  await screen.findByText('plugin.list.noTriggerFound')
  expect(screen.queryByRole('button', { name: 'plugin.installAction' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'plugin.source.marketplace' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'plugin.debugInfo.title' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /plugin.autoUpdate.autoUpdate/ }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'plugin.privilege.permissions' }),
  ).not.toBeInTheDocument()
  expect(api.debug).not.toHaveBeenCalled()
})

it('persists legacy permission changes and immediately hides installations when nobody may install', async () => {
  const user = userEvent.setup()
  renderPage({ props: { section: 'trigger' }, rbacEnabled: false })
  await user.click(await screen.findByRole('button', { name: 'plugin.privilege.permissions' }))
  const dialog = screen.getByRole('dialog', { name: 'plugin.privilege.permissions' })
  await user.click(
    within(dialog).getByRole('radio', {
      name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.noone',
    }),
  )
  await waitFor(() =>
    expect(api.savePermission).toHaveBeenCalledWith({
      body: { install_permission: 'noone', debug_permission: 'everyone' },
    }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  expect(screen.queryByRole('button', { name: 'plugin.installAction' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.privilege.permissions' }))
  expect(
    screen.getByRole('radio', {
      name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.noone',
    }),
  ).toBeChecked()
})

it('restores the selected legacy permission when saving fails', async () => {
  const user = userEvent.setup()
  api.savePermission.mockRejectedValueOnce(new Error('Unavailable'))
  renderPage({ props: { section: 'trigger' }, rbacEnabled: false })
  await user.click(await screen.findByRole('button', { name: 'plugin.privilege.permissions' }))
  await user.click(
    screen.getByRole('radio', {
      name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.noone',
    }),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('radio', {
        name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.everyone',
      }),
    ).toBeChecked(),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(screen.getByRole('button', { name: 'plugin.installAction' })).toBeEnabled()
})

it.each([true, false])(
  'waits for permission before consuming a marketplace URL; installation allowed: %s',
  async (allowed) => {
    const user = userEvent.setup()
    const permission = createDeferred<Awaited<ReturnType<typeof api.permission>>>()
    api.permission.mockReturnValueOnce(permission.promise)
    const packageId = 'test/trigger:1.0.0@package'
    const view = renderPage({
      props: { section: 'trigger' },
      rbacEnabled: false,
      searchParams: { 'package-ids': JSON.stringify([packageId]) },
    })
    await screen.findByText('plugin.list.noTriggerFound')
    expect(api.manifest).not.toHaveBeenCalled()
    expect(view.onUrlUpdate).not.toHaveBeenCalled()
    await act(async () =>
      permission.resolve({
        install_permission: allowed ? 'everyone' : 'noone',
        debug_permission: 'everyone',
      }),
    )
    if (allowed) {
      const dialog = await screen.findByRole('dialog', {
        name: 'plugin.installModal.installPlugin',
      })
      expect(within(dialog).getByText('Trigger Package')).toBeInTheDocument()
      expect(api.manifest).toHaveBeenCalledWith(encodeURIComponent(packageId))
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    } else {
      expect(api.manifest).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
    await waitFor(() =>
      expect(view.onUrlUpdate.mock.lastCall?.[0].searchParams.has('package-ids')).toBe(false),
    )
  },
)

it('opens the real local installer for a dropped tool package and clears it when cancelled', async () => {
  const user = userEvent.setup()
  renderPage({ props: { section: 'builtin' } })
  await screen.findByRole('button', { name: 'plugin.installAction' })
  const file = new File(['package'], 'tool.difypkg', { type: 'application/octet-stream' })
  fireEvent.drop(screen.getByRole('heading', { name: 'navigation.toolsPage.toolPlugin' }), {
    dataTransfer: { files: [file], types: ['Files'] },
  })
  const dialog = await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
  await waitFor(() => expect(api.upload).toHaveBeenCalledExactlyOnceWith(file, false))
  expect(within(dialog).getByText('tool.difypkg')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(
    screen.getByRole('heading', { name: 'navigation.toolsPage.toolPlugin' }),
  ).toBeInTheDocument()
})

it.each([
  {
    reason: 'permission',
    section: 'builtin' as const,
    workspacePermissionKeys: [],
    restrictLocalPackages: false,
    filename: 'tool.difypkg',
  },
  {
    reason: 'marketplace-only policy',
    section: 'builtin' as const,
    workspacePermissionKeys: permissions,
    restrictLocalPackages: true,
    filename: 'tool.difypkg',
  },
  {
    reason: 'non-tool category',
    section: 'trigger' as const,
    workspacePermissionKeys: permissions,
    restrictLocalPackages: false,
    filename: 'tool.difypkg',
  },
  {
    reason: 'unsupported file',
    section: 'builtin' as const,
    workspacePermissionKeys: permissions,
    restrictLocalPackages: false,
    filename: 'notes.txt',
  },
])(
  'ignores a package drop excluded by $reason',
  async ({ section, workspacePermissionKeys, restrictLocalPackages, filename }) => {
    renderPage({ props: { section }, workspacePermissionKeys, restrictLocalPackages })
    await waitFor(() => expect(api.category).toHaveBeenCalled())
    fireEvent.drop(
      screen.getByRole('heading', {
        name:
          section === 'builtin'
            ? 'navigation.toolsPage.toolPlugin'
            : 'plugin.categorySingle.trigger',
      }),
      { dataTransfer: { files: [new File(['package'], filename)], types: ['Files'] } },
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.upload).not.toHaveBeenCalled()
  },
)
