import type { PluginInstallTaskStartResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type { Dependency, Plugin, PluginManifestInMarket } from '../../../types'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture, createPluginEntity } from '@/test/fixtures/plugin'
import { PermissionType, PluginCategoryEnum, TaskStatus } from '../../../types'
import InstallFromMarketplace from '../index'

const { install, upgrade, installedPlugins, declaration, pollTask, marketplace, refresh } =
  vi.hoisted(() => ({
    install: vi.fn(),
    upgrade: vi.fn(),
    installedPlugins: vi.fn(),
    declaration: vi.fn(),
    pollTask: vi.fn(),
    marketplace: vi.fn(),
    refresh: vi.fn(),
  }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: marketplace,
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  checkTaskStatus: pollTask,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.marketplace.pkg.get': declaration,
      'workspaces.current.plugin.install.marketplace.post': install,
      'workspaces.current.plugin.upgrade.marketplace.post': upgrade,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': installedPlugins,
    }),
  }
})
// Catalog refresh is independently covered by use-refresh-plugin-list.
vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: refresh }),
}))

const createMockManifest = (
  overrides: Partial<PluginManifestInMarket> = {},
): PluginManifestInMarket => ({
  plugin_unique_identifier: 'test-unique-identifier',
  name: 'test-plugin',
  org: 'test-org',
  icon: 'test-icon.png',
  label: { en_US: 'Test Plugin' } as PluginManifestInMarket['label'],
  category: PluginCategoryEnum.tool,
  version: '1.0.0',
  latest_version: '1.0.0',
  brief: { en_US: 'A test plugin' } as PluginManifestInMarket['brief'],
  introduction: 'Introduction text',
  verified: true,
  install_count: 100,
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createMockPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'test-plugin',
  plugin_id: 'test-plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-package-id',
  icon: 'test-icon.png',
  verified: true,
  label: { en_US: 'Test Plugin' },
  brief: { en_US: 'A test plugin' },
  description: { en_US: 'A test plugin description' },
  introduction: 'Introduction text',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 100,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const renderInstaller = (
  props: Partial<ComponentProps<typeof InstallFromMarketplace>> = {},
  options: ConsoleQueryTestOptions = {},
) => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const manifest = createMockManifest()
  const rendered = renderWithConsoleQuery(
    <InstallFromMarketplace
      uniqueIdentifier="test-unique-identifier"
      manifest={manifest}
      onClose={onClose}
      onSuccess={onSuccess}
      {...props}
    />,
    {
      accountProfileMeta: { currentVersion: '1.0.0' },
      workspacePermissionKeys: ['plugin.install'],
      systemFeatures: {
        enable_marketplace: true,
        rbac_enabled: true,
        plugin_installation_permission: {
          plugin_installation_scope: 'all',
          restrict_to_marketplace_only: false,
        },
      },
      ...options,
    },
  )
  return { ...rendered, onClose, onSuccess, manifest }
}

const installButton = () => screen.getByRole('button', { name: 'plugin.installModal.install' })
const successDialog = () =>
  screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
// The footer and the dialog dismiss button share a name; the footer is the visible text action.
const closeResult = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByText('common.operation.close'))

beforeEach(() => {
  vi.resetAllMocks()
  install.mockResolvedValue({ all_installed: true, task_id: '' })
  upgrade.mockResolvedValue({ all_installed: true, task_id: '' })
  installedPlugins.mockResolvedValue({ plugins: [] })
  declaration.mockResolvedValue({ manifest: createPluginDeclarationFixture() })
  pollTask.mockResolvedValue({
    task: {
      plugins: [{ plugin_unique_identifier: 'test-unique-identifier', status: TaskStatus.success }],
    },
  })
})

it('installs the displayed version once while pending, refreshes the catalog and completes on close', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<PluginInstallTaskStartResponse>()
  install.mockReturnValueOnce(pending.promise)
  const { onSuccess, onClose, manifest } = renderInstaller({
    uniqueIdentifier: 'selected-version-id',
  })
  expect(
    screen.getByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
  ).toBeInTheDocument()
  expect(screen.getByText('Test Plugin')).toBeInTheDocument()
  expect(screen.getByText('1.0.0')).toBeInTheDocument()

  await user.click(installButton())
  const installing = await screen.findByRole('button', { name: 'plugin.installModal.installing' })
  expect(installing).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'common.operation.cancel' })).not.toBeInTheDocument()
  await user.click(installing)
  expect(install).toHaveBeenCalledOnce()
  expect(onSuccess).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  await act(async () => pending.resolve({ all_installed: true, task_id: '' }))
  await successDialog()

  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['selected-version-id'] },
  })
  expect(upgrade).not.toHaveBeenCalled()
  expect(pollTask).not.toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledExactlyOnceWith(manifest)
  expect(onSuccess).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'plugin.installModal.install' }),
  ).not.toBeInTheDocument()
  await closeResult(user)
  expect(onSuccess).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
})

it.each(['common.operation.cancel', 'common.operation.close'])(
  'dismisses before installation through %s',
  async (name) => {
    const user = userEvent.setup()
    const { onClose, onSuccess } = renderInstaller()
    await user.click(screen.getByRole('button', { name }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  },
)

it('waits for a legacy task result without refreshing the catalog a second time', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{
    task: { plugins: { plugin_unique_identifier: string; status: TaskStatus }[] }
  }>()
  install.mockResolvedValueOnce({ all_installed: false, task_id: 'task-123' })
  pollTask.mockReturnValueOnce(pending.promise)
  renderInstaller()
  await user.click(installButton())
  await waitFor(() => expect(pollTask).toHaveBeenCalledExactlyOnceWith('task-123'))
  expect(
    screen.queryByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
  ).not.toBeInTheDocument()
  await act(async () =>
    pending.resolve({
      task: {
        plugins: [
          { plugin_unique_identifier: 'test-unique-identifier', status: TaskStatus.success },
        ],
      },
    }),
  )
  await successDialog()
  expect(refresh).not.toHaveBeenCalled()
})

it('hands a started task to the task list and closes without claiming installation succeeded', async () => {
  const user = userEvent.setup()
  const task: NonNullable<PluginInstallTaskStartResponse['task']> = {
    id: 'task-123',
    created_at: '2026-06-05T03:34:59Z',
    updated_at: '2026-06-05T03:34:59Z',
    status: TaskStatus.running,
    total_plugins: 1,
    completed_plugins: 0,
    plugins: [
      {
        plugin_unique_identifier: 'test-unique-identifier',
        plugin_id: 'test-plugin-id',
        source: 'marketplace',
        status: TaskStatus.pending,
        message: '',
        icon: 'test-icon.png',
        labels: { en_US: 'Test Plugin' },
      },
    ],
  }
  install.mockResolvedValueOnce({ all_installed: false, task_id: task.id, task })
  const { onClose, onSuccess, queryClient } = renderInstaller()
  await user.click(installButton())
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(queryClient.getQueryData(['plugins', 'pluginTaskList'])).toEqual({
    tasks: [expect.objectContaining({ id: task.id, status: TaskStatus.running })],
  })
  expect(pollTask).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})

it('shows a failed task message and allows closing the result', async () => {
  const user = userEvent.setup()
  install.mockResolvedValueOnce({ all_installed: false, task_id: 'failed-task' })
  pollTask.mockResolvedValueOnce({
    task: {
      plugins: [
        {
          plugin_unique_identifier: 'test-unique-identifier',
          status: TaskStatus.failed,
          message: 'Package verification failed',
        },
      ],
    },
  })
  const { onSuccess } = renderInstaller()
  await user.click(installButton())
  await screen.findByRole('dialog', { name: 'plugin.installModal.installFailed' })
  expect(screen.getByText('Package verification failed')).toBeInTheDocument()
  expect(refresh).not.toHaveBeenCalled()
  await closeResult(user)
  expect(onSuccess).toHaveBeenCalledOnce()
})

it.each([
  ['Request rejected', 'Request rejected'],
  [new Error('Request rejected'), 'plugin.installModal.installFailedDesc'],
])('shows an installation request failure: %s', async (error, message) => {
  const user = userEvent.setup()
  install.mockRejectedValueOnce(error)
  renderInstaller()
  await user.click(installButton())
  await screen.findByRole('dialog', { name: 'plugin.installModal.installFailed' })
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(refresh).not.toHaveBeenCalled()
  expect(pollTask).not.toHaveBeenCalled()
})

it('waits for installed-version lookup, then upgrades the existing plugin', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{ plugins: ReturnType<typeof createPluginEntity>[] }>()
  installedPlugins.mockReturnValueOnce(pending.promise)
  renderInstaller({ manifest: createMockPlugin() })
  expect(installButton()).toBeDisabled()
  await user.click(installButton())
  expect(install).not.toHaveBeenCalled()
  const existingPlugin = createPluginEntity({
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'previous-version-id',
  })
  existingPlugin.declaration.version = '0.9.0'
  await act(async () => pending.resolve({ plugins: [existingPlugin] }))
  await waitFor(() => expect(installButton()).toBeEnabled())
  expect(screen.getByText('0.9.0 -> 1.0.0')).toBeInTheDocument()
  await user.click(installButton())
  await successDialog()
  expect(upgrade).toHaveBeenCalledExactlyOnceWith({
    body: {
      original_plugin_unique_identifier: 'previous-version-id',
      new_plugin_unique_identifier: 'test-unique-identifier',
    },
  })
  expect(install).not.toHaveBeenCalled()
})

it('recognizes an already installed package without submitting it again', async () => {
  installedPlugins.mockResolvedValueOnce({
    plugins: [
      createPluginEntity({
        plugin_id: 'test-plugin-id',
        plugin_unique_identifier: 'test-unique-identifier',
      }),
    ],
  })
  renderInstaller({ manifest: createMockPlugin() })
  await successDialog()
  expect(install).not.toHaveBeenCalled()
  expect(upgrade).not.toHaveBeenCalled()
})

it('blocks installation when the workspace scope disallows the plugin', async () => {
  const user = userEvent.setup()
  renderInstaller(
    {},
    { systemFeatures: { plugin_installation_permission: { plugin_installation_scope: 'none' } } },
  )
  expect(installButton()).toBeDisabled()
  await user.click(installButton())
  expect(install).not.toHaveBeenCalled()
})

it.each([
  ['2.0.0', true],
  ['0.9.0', false],
])('compares Dify 1.0.0 against the minimum version %s', async (minimumVersion, warns) => {
  const response = {
    manifest: createPluginDeclarationFixture({
      meta: { version: '1.0.0', minimum_dify_version: minimumVersion },
    }),
  }
  declaration.mockResolvedValueOnce(response)
  const { queryClient } = renderInstaller()
  await waitFor(() =>
    expect(
      queryClient.getQueryData(['plugins', 'pluginDeclaration', 'test-unique-identifier']),
    ).toEqual(response),
  )
  if (warns) expect(await screen.findByText(/plugin.difyVersionNotCompatible/)).toBeInTheDocument()
  else expect(screen.queryByText(/plugin.difyVersionNotCompatible/)).not.toBeInTheDocument()
})

it('installs marketplace bundle dependencies through the real bundle flow', async () => {
  const user = userEvent.setup()
  const plugin = createMockPlugin({
    name: 'bundle-plugin',
    plugin_id: 'test-org/bundle-plugin',
    latest_package_identifier: 'test-org/bundle-plugin:1.0.0',
  })
  const dependencies: Dependency[] = [
    {
      type: 'marketplace',
      value: { marketplace_plugin_unique_identifier: plugin.latest_package_identifier },
    },
  ]
  marketplace.mockResolvedValueOnce({ data: { list: [{ plugin }] } })
  const { onClose, onSuccess } = renderInstaller({ isBundle: true, dependencies })
  await waitFor(() => expect(installButton()).toBeEnabled())
  await user.click(installButton())
  await successDialog()
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: [plugin.latest_package_identifier] },
  })
  expect(refresh).toHaveBeenCalledWith(undefined, true)
  await closeResult(user)
  expect(onClose).toHaveBeenCalledOnce()
  expect(onSuccess).not.toHaveBeenCalled()
})
