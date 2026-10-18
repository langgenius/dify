import type { ComponentProps, ReactElement } from 'react'
import type { VersionListResponse } from '@/app/components/plugins/types'
import type { consoleClient } from '@/service/console'
import {
  zPluginDecodeResponse,
  zPluginEntity,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSource } from '@/app/components/plugins/types'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { normalizeInstalledPluginDetail } from '@/service/use-plugins'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import DetailHeader from '../index'

const api = vi.hoisted(() => ({
  releases: vi.fn<typeof fetch>(),
  versions: vi.fn<() => Promise<{ data: VersionListResponse }>>(),
  autoUpgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.autoUpgrade.fetch.get>(),
  upload: vi.fn<typeof consoleClient.workspaces.current.plugin.upload.github.post>(),
  upgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.upgrade.github.post>(),
  marketplaceUpgrade:
    vi.fn<typeof consoleClient.workspaces.current.plugin.upgrade.marketplace.post>(),
  models: vi.fn<typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': api.models,
      'workspaces.current.modelProviders.summary.get': async () => ({ data: [], plugins: {} }),
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.upload.github.post': api.upload,
      'workspaces.current.plugin.upgrade.github.post': api.upgrade,
      'workspaces.current.plugin.upgrade.marketplace.post': api.marketplaceUpgrade,
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.autoUpgrade.fetch.get': api.autoUpgrade,
    }),
  }
})

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  getMarketplace: api.versions,
}))

const autoUpgrade = {
  strategy_setting: 'disabled',
  upgrade_mode: 'all',
  upgrade_time_of_day: 0,
  include_plugins: [],
  exclude_plugins: [],
} as const

const installed = zPluginEntity.parse({
  ...createPluginEntity(),
  installation_id: 'plugin-entity-id',
  name: 'plugin-entity',
})
const manifest = { ...installed.declaration, category: 'model', version: '2.0.0', tags: [] }
const detail = normalizeInstalledPluginDetail(
  zPluginEntity.parse({
    ...installed,
    source: 'github',
    declaration: { ...installed.declaration, category: 'model' },
    meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'plugin.difypkg' },
  }),
)
const uploadedPackage = zPluginDecodeResponse.parse({
  unique_identifier: 'langgenius/plugin-entity:2.0.0@test',
  manifest,
})
const releases = [
  {
    tag: 'v2.0.0',
    assets: [
      { downloadUrl: 'https://github.com/owner/repo/releases/download/v2.0.0/plugin.difypkg' },
    ],
  },
]
const render = createNuqsTestRenderer((ui: ReactElement, enableMarketplace: boolean = true) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(ui, {
    queryClient,
    features: {},
    systemFeatures: { enable_marketplace: enableMarketplace },
  })
})
function setup(props: Partial<ComponentProps<typeof DetailHeader>> = {}, enableMarketplace = true) {
  const onUpdate = vi.fn<() => void | Promise<void>>()
  render(
    <ModalContextProvider>
      <DetailHeader detail={detail} onUpdate={onUpdate} {...props} />
      <AppToastHost timeout={0} />
    </ModalContextProvider>,
    enableMarketplace,
  )
  return { user: userEvent.setup(), onUpdate }
}
beforeEach(() => {
  api.releases.mockReset().mockImplementation(async (url) => {
    if (url !== 'https://ungh.cc/repos/owner/repo/releases')
      throw new Error(`Unexpected request: ${url instanceof Request ? url.url : url}`)
    return Response.json({ releases })
  })
  vi.stubGlobal('fetch', api.releases)
  api.upload.mockReset().mockResolvedValue(uploadedPackage)
  api.upgrade.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.marketplaceUpgrade.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.models.mockReset().mockResolvedValue({ data: [] })
  api.autoUpgrade.mockReset().mockResolvedValue({
    category: 'model',
    auto_upgrade: { ...autoUpgrade, include_plugins: [], exclude_plugins: [] },
  })
  api.versions.mockReset().mockResolvedValue({
    data: {
      versions: ['2.0.0', '1.0.0', '0.5.0'].map((version) => ({
        plugin_org: 'langgenius',
        plugin_name: 'plugin-entity',
        version,
        file_name: 'plugin.difypkg',
        checksum: version,
        created_at: '2026-06-01T00:00:00Z',
        unique_identifier: `langgenius/plugin-entity:${version}@test`,
      })),
    },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  act(() => toast.dismiss())
})

it('updates the selected GitHub package, refreshes model catalogs, and keeps the modal pending until its consumer finishes', async () => {
  const refresh = createDeferred<void>()
  const onUpdate = vi.fn(() => refresh.promise)
  const { user } = setup({ onUpdate })
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'plugin.installFromGitHub.updatePlugin',
  })
  await user.click(
    within(dialog).getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
  )
  await user.click(await screen.findByRole('option', { name: 'v2.0.0' }))
  await user.click(
    within(dialog).getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }),
  )
  await user.click(await screen.findByRole('option', { name: 'plugin.difypkg' }))
  await user.click(within(dialog).getByRole('button', { name: 'plugin.installModal.next' }))
  await user.click(
    await within(dialog).findByRole('button', { name: 'plugin.installModal.install' }),
  )
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  expect(api.releases).toHaveBeenCalledExactlyOnceWith('https://ungh.cc/repos/owner/repo/releases')
  expect(api.upload).toHaveBeenCalledWith({
    body: { repo: 'owner/repo', version: 'v2.0.0', package: 'plugin.difypkg' },
  })
  expect(api.upgrade).toHaveBeenCalledWith({
    body: {
      repo: 'owner/repo',
      version: 'v2.0.0',
      package: 'plugin.difypkg',
      original_plugin_unique_identifier: detail.plugin_unique_identifier,
      new_plugin_unique_identifier: uploadedPackage.unique_identifier,
    },
  })
  expect(
    within(dialog).getByRole('button', { name: 'plugin.installModal.installing' }),
  ).toHaveAttribute('aria-disabled', 'true')
  expect(dialog).toBeInTheDocument()
  await waitFor(() => expect(api.models).toHaveBeenCalledWith({ params: { model_type: 'llm' } }))
  await act(async () => refresh.resolve())
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(
    screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }),
  ).toBeInTheDocument()
})

it.each([{ availableReleases: [] }, { availableReleases: [{ tag: 'v1.0.0', assets: [] }] }])(
  'keeps the installed plugin usable when GitHub has no newer release: %j',
  async ({ availableReleases }) => {
    api.releases.mockResolvedValueOnce(Response.json({ releases: availableReleases }))
    const { user, onUpdate } = setup()
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))
    if (availableReleases.length) await screen.findByText('No new version available')
    expect(
      screen.queryByRole('dialog', { name: 'plugin.installFromGitHub.updatePlugin' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }),
    ).toBeEnabled()
    expect(api.upload).not.toHaveBeenCalled()
    expect(api.upgrade).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  },
)

it('keeps marketplace confirmation open until the updated plugin list is available', async () => {
  const refresh = createDeferred<void>()
  const onUpdate = vi.fn(() => refresh.promise)
  const { user } = setup({
    onUpdate,
    detail: {
      ...detail,
      source: PluginSource.marketplace,
      latest_version: '2.0.0',
      latest_unique_identifier: uploadedPackage.unique_identifier,
    },
  })
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))
  const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  expect(dialog).toBeInTheDocument()
  await act(async () => refresh.resolve())
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it.each([
  { strategy: 'disabled', mode: 'all', listed: false, warning: false },
  { strategy: 'latest', mode: 'all', listed: false, warning: true },
  { strategy: 'latest', mode: 'partial', listed: true, warning: true },
  { strategy: 'latest', mode: 'partial', listed: false, warning: false },
  { strategy: 'latest', mode: 'exclude', listed: true, warning: false },
  { strategy: 'latest', mode: 'exclude', listed: false, warning: true },
  { strategy: 'latest', mode: 'all', listed: false, warning: false, marketplace: false },
] as const)(
  'warns before downgrading only when this plugin is eligible for automatic updates: %j',
  async ({ strategy, mode, listed, warning, ...options }) => {
    api.autoUpgrade.mockResolvedValue({
      category: 'model',
      auto_upgrade: {
        ...autoUpgrade,
        strategy_setting: strategy,
        upgrade_mode: mode,
        include_plugins: listed ? [detail.plugin_id] : ['other-plugin'],
        exclude_plugins: listed ? [detail.plugin_id] : ['other-plugin'],
      },
    })
    const { user } = setup(
      { detail: { ...detail, source: PluginSource.marketplace } },
      'marketplace' in options ? options.marketplace : true,
    )
    await user.click(screen.getByRole('button', { name: '1.0.0' }))
    await user.click(await screen.findByRole('button', { name: /^0\.5\.0/ }))
    const dialog = await screen.findByRole('dialog', {
      name: warning ? 'plugin.autoUpdate.pluginDowngradeWarning.title' : 'plugin.upgrade.title',
    })
    if (warning)
      expect(
        within(dialog).getByRole('button', {
          name: 'plugin.autoUpdate.pluginDowngradeWarning.exclude',
        }),
      ).toBeInTheDocument()
    else
      expect(
        within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }),
      ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('button', {
        name: warning ? 'app.newApp.Cancel' : 'common.operation.cancel',
      }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(api.marketplaceUpgrade).not.toHaveBeenCalled()
  },
)

it('uses the newly selected target after cancelling a downgrade', async () => {
  api.autoUpgrade.mockResolvedValue({
    category: 'model',
    auto_upgrade: {
      ...autoUpgrade,
      strategy_setting: 'latest',
      include_plugins: [],
      exclude_plugins: [],
    },
  })
  const { user } = setup({ detail: { ...detail, source: PluginSource.marketplace } })
  await user.click(screen.getByRole('button', { name: '1.0.0' }))
  await user.click(await screen.findByRole('button', { name: /^0\.5\.0/ }))
  const downgrade = await screen.findByRole('dialog', {
    name: 'plugin.autoUpdate.pluginDowngradeWarning.title',
  })
  await user.click(within(downgrade).getByRole('button', { name: 'app.newApp.Cancel' }))
  await waitFor(() => expect(downgrade).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '1.0.0' }))
  await user.click(await screen.findByRole('button', { name: /^2\.0\.0/ }))
  const upgrade = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  expect(
    within(upgrade).queryByRole('button', {
      name: 'plugin.autoUpdate.pluginDowngradeWarning.exclude',
    }),
  ).not.toBeInTheDocument()
  await user.click(within(upgrade).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  expect(api.marketplaceUpgrade).toHaveBeenCalledWith({
    body: {
      original_plugin_unique_identifier: detail.plugin_unique_identifier,
      new_plugin_unique_identifier: uploadedPackage.unique_identifier,
    },
  })
  await waitFor(() => expect(upgrade).not.toBeInTheDocument())
})

it.each([
  [PluginSource.marketplace, '2.0.0', true],
  [PluginSource.marketplace, '1.0.0', false],
  [PluginSource.marketplace, '', false],
  [PluginSource.local, '2.0.0', false],
] as const)(
  'offers an update for source %s and latest version %s only when actionable',
  (source, latest_version, available) => {
    setup({ detail: { ...detail, source, latest_version } })
    const button = screen.queryByRole('button', { name: 'plugin.detailPanel.operation.update' })
    if (available) expect(button).toBeEnabled()
    else expect(button).not.toBeInTheDocument()
  },
)

it('opens GitHub repository and package information from the real action menu', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.info' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'plugin.pluginInfoModal.title' })
  expect(within(dialog).getByText('https://github.com/owner/repo')).toBeInTheDocument()
  expect(within(dialog).getByText('1.0.0')).toBeInTheDocument()
  expect(within(dialog).getByText('plugin.difypkg')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(
    screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
  ).toBeEnabled()
})
