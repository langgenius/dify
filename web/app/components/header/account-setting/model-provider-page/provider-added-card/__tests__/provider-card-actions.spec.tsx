import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { ComponentProps, ReactElement } from 'react'
import type { ModelProviderPluginSummary } from '../../index'
import type { consoleClient } from '@/service/console'
import { zPostWorkspacesCurrentPluginListInstallationsIdsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { consoleQuery } from '@/service/console'
import { normalizeInstalledPluginDetail } from '@/service/use-plugins'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import ProviderCardActions from '../provider-card-actions'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.workspaces.current.plugin.list.installations.ids.post>(),
  uninstall: vi.fn<typeof consoleClient.workspaces.current.plugin.uninstall.post>(),
  upgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.upgrade.marketplace.post>(),
  versions: vi.fn<() => Promise<PluginVersionsResponse>>(),
  releases: vi.fn<typeof fetch>(),
  autoUpgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.autoUpgrade.fetch.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.upgrade.marketplace.post': api.upgrade,
      'workspaces.current.plugin.list.installations.ids.post': api.detail,
      'workspaces.current.plugin.uninstall.post': api.uninstall,
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
      'workspaces.current.modelProviders.summary.get': async () => ({ data: [], plugins: {} }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.uninstall.post': api.uninstall,
      'workspaces.current.plugin.upgrade.marketplace.post': api.upgrade,
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.autoUpgrade.fetch.get': api.autoUpgrade,
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    ...actual,
    marketplaceQuery: createTanstackQueryUtils(
      {
        ...actual.marketplaceClient,
        pluginVersions: api.versions,
      },
      { path: ['marketplace'] },
    ),
  }
})

const identifier = (version: string) => `langgenius/plugin-entity:${version}@test`
const installed = zPostWorkspacesCurrentPluginListInstallationsIdsResponse.parse({
  plugins: [
    {
      ...createPluginEntity(),
      installation_id: 'plugin-entity-id',
      name: 'plugin-entity',
      declaration: { ...createPluginEntity().declaration, category: PluginCategoryEnum.model },
    },
  ],
}).plugins[0]!
const github = zPostWorkspacesCurrentPluginListInstallationsIdsResponse.parse({
  plugins: [
    {
      ...installed,
      source: 'github',
      meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'plugin.difypkg' },
    },
  ],
}).plugins[0]!
const summary = (
  overrides: Partial<ModelProviderPluginSummary> = {},
): ModelProviderPluginSummary => ({
  installation_id: installed.id,
  plugin_id: installed.plugin_id,
  plugin_unique_identifier: installed.plugin_unique_identifier,
  runtime_type: 'local',
  source: 'marketplace',
  version: '1.0.0',
  ...overrides,
})
const render = createNuqsTestRenderer((ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(ui, {
    queryClient,
    features: {},
    systemFeatures: { enable_marketplace: true, rbac_enabled: true },
    workspacePermissionKeys: ['plugin.install', 'plugin.delete'],
  })
})
function setup(
  props: ComponentProps<typeof ProviderCardActions> = {
    summary: summary(),
    providerLabel: 'Provider Plugin',
  },
) {
  const result = render(
    <ModalContextProvider>
      <ProviderCardActions {...props} />
      <AppToastHost timeout={0} />
    </ModalContextProvider>,
  )
  return { ...result, user: userEvent.setup() }
}
const openActions = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    await screen.findByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
  )
}
beforeEach(() => {
  api.autoUpgrade.mockReset().mockResolvedValue({
    category: 'model',
    auto_upgrade: {
      strategy_setting: 'disabled',
      upgrade_mode: 'all',
      upgrade_time_of_day: 0,
      include_plugins: [],
      exclude_plugins: [],
    },
  })
  api.detail.mockReset().mockResolvedValue({ plugins: [installed] })
  api.uninstall.mockReset().mockResolvedValue({ success: true })
  api.upgrade.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.versions.mockReset().mockResolvedValue({
    data: {
      versions: ['2.0.0', '1.0.0', '0.5.0'].map((version) => ({
        plugin_org: 'langgenius',
        plugin_name: 'plugin-entity',
        version,
        file_name: 'plugin.difypkg',
        checksum: version,
        created_at: '2026-06-01T00:00:00Z',
        unique_identifier: identifier(version),
      })),
    },
  })
  api.releases.mockReset().mockImplementation(async (url) => {
    if (url !== 'https://ungh.cc/repos/owner/repo/releases')
      throw new Error(`Unexpected request: ${url}`)
    return Response.json({ releases: [{ tag: 'v1.0.0', assets: [] }] })
  })
  vi.stubGlobal('fetch', api.releases)
})
afterEach(() => {
  vi.unstubAllGlobals()
  act(() => toast.dismiss())
})

it('loads independent version prerequisites together and keeps the trigger focused while loading', async () => {
  const details = createDeferred<Awaited<ReturnType<typeof api.detail>>>()
  const versions = createDeferred<PluginVersionsResponse>()
  const versionResponse = await api.versions()
  api.versions.mockClear().mockReturnValueOnce(versions.promise)
  api.detail.mockReturnValueOnce(details.promise)
  const { user } = setup()
  const trigger = await screen.findByRole('button', { name: '1.0.0' })
  expect(api.detail).not.toHaveBeenCalled()
  expect(api.versions).not.toHaveBeenCalled()

  await user.click(trigger)
  await waitFor(() => {
    expect(api.detail).toHaveBeenCalledOnce()
    expect(api.versions).toHaveBeenCalledOnce()
  })
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await user.click(trigger)
  expect(api.detail).toHaveBeenCalledOnce()
  await act(async () => details.resolve({ plugins: [installed] }))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await act(async () => versions.resolve(versionResponse))
  expect(
    await screen.findByRole('menu', { name: 'plugin.detailPanel.switchVersion' }),
  ).toBeInTheDocument()
  expect(trigger).not.toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  expect(api.detail).toHaveBeenCalledOnce()
  expect(api.versions).toHaveBeenCalledOnce()
})

it('allows retrying a failed version query without reloading successful installation details', async () => {
  api.versions.mockRejectedValueOnce(new Error('marketplace unavailable'))
  const { user } = setup()
  await user.click(await screen.findByRole('button', { name: '1.0.0' }))
  await user.click(await screen.findByRole('menuitem', { name: 'common.operation.retry' }))
  expect(await screen.findByRole('menuitem', { name: /^2\.0\.0/ })).toBeInTheDocument()
  expect(api.versions).toHaveBeenCalledTimes(2)
  expect(api.detail).toHaveBeenCalledOnce()
})

it('loads GitHub package details only when the user opens plugin information', async () => {
  api.detail.mockResolvedValue({ plugins: [github] })
  const { user } = setup({
    summary: summary({ source: 'github' }),
    providerLabel: 'Provider Plugin',
  })
  expect(api.detail).not.toHaveBeenCalled()
  await openActions(user)
  await user.click(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.info' }))
  const dialog = await screen.findByRole('dialog', { name: 'plugin.pluginInfoModal.title' })
  expect(within(dialog).getByText('https://github.com/owner/repo')).toBeInTheDocument()
  expect(within(dialog).getByText('plugin.difypkg')).toBeInTheDocument()
  expect(api.detail).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_ids: [installed.plugin_id] },
  })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it('uses the latest summary package when the loaded detail still describes the installed version', async () => {
  const onUpdate = vi.fn()
  const { user } = setup({
    summary: summary({ latestVersion: '2.0.0', latestUniqueIdentifier: identifier('2.0.0') }),
    providerLabel: 'Provider Plugin',
    onUpdate,
  })
  await user.click(
    await screen.findByRole('button', { name: 'plugin.detailPanel.operation.update' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  expect(api.upgrade).toHaveBeenCalledExactlyOnceWith({
    body: {
      original_plugin_unique_identifier: installed.plugin_unique_identifier,
      new_plugin_unique_identifier: identifier('2.0.0'),
    },
  })
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it.each(['2.0.0', '0.5.0'])(
  'keeps the loaded version until the summary refresh finishes after selecting %s',
  async (next) => {
    const refresh = createDeferred<void>()
    const onUpdate = vi.fn(() => refresh.promise)
    const { user, rerender } = setup({
      summary: summary(),
      providerLabel: 'Provider Plugin',
      onUpdate,
    })
    await user.click(await screen.findByRole('button', { name: '1.0.0' }))
    await user.click(
      await screen.findByRole('menuitem', { name: new RegExp(`^${next.replaceAll('.', '\\.')}`) }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
    await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(api.upgrade).toHaveBeenCalledExactlyOnceWith({
      body: {
        original_plugin_unique_identifier: installed.plugin_unique_identifier,
        new_plugin_unique_identifier: identifier(next),
      },
    })
    rerender(
      <ModalContextProvider>
        <ProviderCardActions
          summary={summary({ version: next, plugin_unique_identifier: identifier(next) })}
          providerLabel="Provider Plugin"
          onUpdate={onUpdate}
        />
        <AppToastHost timeout={0} />
      </ModalContextProvider>,
    )
    expect(within(dialog).getByText(`1.0.0 -> ${next}`)).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    await act(async () => refresh.resolve())
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: next })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1.0.0' })).not.toBeInTheDocument()
  },
)

it('keeps the loaded plugin and confirmation usable when refreshing the summary fails', async () => {
  const onUpdate = vi
    .fn()
    .mockRejectedValueOnce(new Error('refresh failed'))
    .mockResolvedValue(undefined)
  const { user } = setup({ summary: summary(), providerLabel: 'Provider Plugin', onUpdate })
  await user.click(await screen.findByRole('button', { name: '1.0.0' }))
  await user.click(await screen.findByRole('menuitem', { name: /^2\.0\.0/ }))
  const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  expect(within(dialog).getByText('1.0.0 -> 2.0.0')).toBeInTheDocument()
  await user.click(await within(dialog).findByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it('keeps a failed removal retryable without loading plugin details and refreshes caches after success', async () => {
  const removal = createDeferred<Awaited<ReturnType<typeof api.uninstall>>>()
  api.uninstall.mockReturnValueOnce(removal.promise)
  const onUpdate = vi.fn()
  const { user, queryClient } = setup({
    summary: summary(),
    providerLabel: 'Provider Plugin',
    onUpdate,
  })
  const providersKey = consoleQuery.workspaces.current.modelProviders.get.queryKey()
  const summaryKey = consoleQuery.workspaces.current.modelProviders.summary.get.queryKey()
  const installedKey = consoleQuery.workspaces.current.plugin.installedIds.get.queryKey({
    input: { query: { category: 'model' } },
  })
  const detailKey = consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryKey({
    input: { body: { plugin_ids: [installed.plugin_id] } },
  })
  const latestKey = consoleQuery.workspaces.current.plugin.list.latestVersions.post.queryKey({
    input: { body: { plugin_ids: [installed.plugin_id] } },
  })
  queryClient.setQueryData(providersKey, { data: [] })
  queryClient.setQueryData(summaryKey, { data: [], plugins: {} })
  queryClient.setQueryData(installedKey, { plugin_ids: [installed.plugin_id] })
  queryClient.setQueryData(detailKey, { plugins: [installed] })
  queryClient.setQueryData(latestKey, { versions: {} })
  const relatedKeys = [providersKey, summaryKey, installedKey, detailKey, latestKey]
  await openActions(user)
  await user.click(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }))
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'common.operation.confirm' })
  await user.click(confirm)
  await user.click(confirm)
  expect(api.uninstall).toHaveBeenCalledExactlyOnceWith({
    body: {
      plugin_installation_id: installed.id,
      preserve_credentials: false,
    },
  })
  expect(onUpdate).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  expect(dialog).toBeInTheDocument()
  await act(async () => removal.resolve({ success: false }))
  expect(dialog).toBeInTheDocument()
  for (const key of relatedKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
  await user.click(confirm)
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  expect(api.uninstall).toHaveBeenCalledTimes(2)
  for (const key of relatedKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  expect(api.detail).not.toHaveBeenCalled()
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it('loads GitHub details before checking releases from the summary menu', async () => {
  api.detail.mockResolvedValue({ plugins: [github] })
  const { user } = setup({
    summary: summary({ source: 'github' }),
    providerLabel: 'Provider Plugin',
  })
  expect(screen.queryByRole('button', { name: '1.0.0' })).not.toBeInTheDocument()
  await openActions(user)
  await user.click(
    screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.checkUpdate' }),
  )
  expect(await screen.findByText('No new version available')).toBeInTheDocument()
  expect(api.releases).toHaveBeenCalledExactlyOnceWith('https://ungh.cc/repos/owner/repo/releases')
  await openActions(user)
  expect(
    screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' }),
  ).toHaveAttribute('href', 'https://github.com/owner/repo')
})

it.each([PluginSource.marketplace, PluginSource.local])(
  'offers a public detail link only for marketplace packages: %s',
  async (source) => {
    const { user } = setup({ detail: { ...normalizeInstalledPluginDetail(installed), source } })
    await openActions(user)
    const link = screen.queryByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' })
    if (source === PluginSource.marketplace) {
      expect(link).toBeInTheDocument()
      const url = new URL(link!.getAttribute('href')!, window.location.origin)
      expect(url.pathname).toBe('/plugins/Dify/plugin-entity')
      expect(url.searchParams.get('language')).toBe('en-US')
    } else expect(link).not.toBeInTheDocument()
  },
)

it.each(['marketplace', 'github'] as const)(
  'revokes mutation controls but preserves public plugin information for %s',
  async (source) => {
    api.detail.mockResolvedValue({ plugins: [source === 'github' ? github : installed] })
    const { user, queryClient } = setup({
      summary: summary({
        source,
        latestVersion: '2.0.0',
        latestUniqueIdentifier: identifier('2.0.0'),
      }),
      providerLabel: 'Provider Plugin',
    })
    if (source === 'marketplace')
      expect(await screen.findByRole('button', { name: '1.0.0' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }),
    ).toBeInTheDocument()
    await act(async () => seedWorkspacePermissionsQuery(queryClient, []))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '1.0.0' })).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'plugin.detailPanel.operation.update' }),
    ).not.toBeInTheDocument()
    await openActions(user)
    expect(
      screen.queryByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'plugin.detailPanel.operation.checkUpdate' }),
    ).not.toBeInTheDocument()
    if (source === 'github') {
      await user.click(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.info' }))
      expect(
        await screen.findByRole('dialog', { name: 'plugin.pluginInfoModal.title' }),
      ).toBeInTheDocument()
    } else {
      expect(
        screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' }),
      ).toHaveAttribute('href', expect.stringContaining('/plugins/langgenius/plugin-entity'))
    }
    expect(api.upgrade).not.toHaveBeenCalled()
    expect(api.uninstall).not.toHaveBeenCalled()
  },
)

it('waits for the auto-upgrade policy before offering a downgrade', async () => {
  const policy = createDeferred<Awaited<ReturnType<typeof api.autoUpgrade>>>()
  api.autoUpgrade.mockReturnValueOnce(policy.promise)
  const { user } = setup()
  const trigger = await screen.findByRole('button', { name: '1.0.0' })
  await user.click(trigger)
  await waitFor(() => expect(api.versions).toHaveBeenCalledOnce())
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveAttribute('aria-disabled', 'true')
  await act(async () =>
    policy.resolve({
      category: 'model',
      auto_upgrade: {
        strategy_setting: 'latest',
        upgrade_mode: 'all',
        upgrade_time_of_day: 0,
        include_plugins: [],
        exclude_plugins: [],
      },
    }),
  )
  await user.click(await screen.findByRole('menuitem', { name: /^0\.5\.0/ }))
  expect(
    await screen.findByRole('alertdialog', {
      name: 'plugin.autoUpdate.pluginDowngradeWarning.title',
    }),
  ).toBeInTheDocument()
  expect(api.upgrade).not.toHaveBeenCalled()
})

it('blocks confirmation if delete permission is revoked while the dialog is open', async () => {
  const { user, queryClient } = setup()
  await openActions(user)
  await user.click(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }))
  const dialog = await screen.findByRole('alertdialog')
  await act(async () => seedWorkspacePermissionsQuery(queryClient, []))
  const confirm = within(dialog).getByRole('button', { name: 'common.operation.confirm' })
  await waitFor(() => expect(confirm).toBeDisabled())
  await user.click(confirm)
  expect(api.uninstall).not.toHaveBeenCalled()
})

it('keeps a later confirmation open when a dismissed update completes', async () => {
  const firstUpgrade = createDeferred<Awaited<ReturnType<typeof api.upgrade>>>()
  api.upgrade.mockReturnValueOnce(firstUpgrade.promise)
  const onUpdate = vi.fn()
  const { user } = setup({ summary: summary(), providerLabel: 'Provider Plugin', onUpdate })
  await user.click(await screen.findByRole('button', { name: '1.0.0' }))
  await user.click(await screen.findByRole('menuitem', { name: /^2\.0\.0/ }))
  const firstDialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  await user.click(within(firstDialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await user.click(within(firstDialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(firstDialog).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '1.0.0' }))
  await user.click(await screen.findByRole('menuitem', { name: /^0\.5\.0/ }))
  const nextDialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  await act(async () => firstUpgrade.resolve({ all_installed: true, task_id: '' }))
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  expect(nextDialog).toBeInTheDocument()
  expect(within(nextDialog).getByText('1.0.0 -> 0.5.0')).toBeInTheDocument()
  expect(within(nextDialog).getByRole('button', { name: 'plugin.upgrade.upgrade' })).toBeEnabled()
})
