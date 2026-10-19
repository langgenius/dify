import type { Dependency, PackageDependency, Plugin } from '../../../types'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture, createPluginEntity } from '@/test/fixtures/plugin'
import { PermissionType, PluginCategoryEnum, TaskStatus } from '../../../types'
import InstallBundle from '../index'

const {
  marketplace,
  checkTask,
  refresh,
  installRequest,
  uploadGithub,
  installGithub,
  installPackage,
  installedPlugins,
  upgrade,
} = vi.hoisted(() => ({
  marketplace: vi.fn(),
  checkTask: vi.fn(),
  refresh: vi.fn(),
  installRequest: vi.fn(),
  uploadGithub: vi.fn(),
  installGithub: vi.fn(),
  installPackage: vi.fn(),
  installedPlugins: vi.fn(),
  upgrade: vi.fn(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: marketplace,
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  checkTaskStatus: checkTask,
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
      'workspaces.current.plugin.install.marketplace.post': installRequest,
      'workspaces.current.plugin.upload.github.post': uploadGithub,
      'workspaces.current.plugin.install.github.post': installGithub,
      'workspaces.current.plugin.install.pkg.post': installPackage,
      'workspaces.current.plugin.upgrade.marketplace.post': upgrade,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': installedPlugins,
    }),
  }
})
// Refreshing unrelated model/tool catalogs is independently covered by use-refresh-plugin-list.
vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: refresh }),
}))

const plugins: Plugin[] = ['finished', 'failed', 'running'].map((name) => ({
  type: 'plugin',
  org: 'test',
  name,
  plugin_id: `test/${name}`,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: `test/${name}:1.0.0`,
  icon: '',
  verified: true,
  label: { en_US: name },
  brief: { en_US: 'Test plugin' },
  description: { en_US: 'Test plugin' },
  introduction: '',
  repository: '',
  category: PluginCategoryEnum.tool,
  install_count: 1,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
}))
const dependencies: Dependency[] = plugins.map((plugin) => ({
  type: 'marketplace',
  value: { marketplace_plugin_unique_identifier: plugin.latest_package_identifier },
}))

beforeEach(() => {
  vi.resetAllMocks()
  installedPlugins.mockResolvedValue({ plugins: [] })
  marketplace.mockResolvedValue({ data: { list: plugins.map((plugin) => ({ plugin })) } })
})

const renderInstall = (
  fromDSLPayload: Dependency[] = dependencies,
  options: ConsoleQueryTestOptions = {},
) => {
  const onInstalled = vi.fn()
  const onClose = vi.fn()
  renderWithConsoleQuery(
    <InstallBundle
      fromDSLPayload={fromDSLPayload}
      onInstallComplete={onInstalled}
      onClose={onClose}
    />,
    {
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
  return { onInstalled, onClose }
}

it('aggregates finished, failed and running installs and polls only the unfinished task', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{ all_installed: boolean; task_id: string }>()
  const install = installRequest.mockImplementation(
    async ({ body }: { body: { plugin_unique_identifiers: string[] } }) => {
      const id = body.plugin_unique_identifiers[0]
      if (id === plugins[1]!.latest_package_identifier) throw new Error('Installation rejected')
      if (id === plugins[2]!.latest_package_identifier) return pending.promise
      return { all_installed: true, task_id: '' }
    },
  )
  checkTask.mockResolvedValue({
    task: {
      plugins: [
        {
          plugin_unique_identifier: plugins[2]!.latest_package_identifier,
          status: TaskStatus.success,
        },
      ],
    },
  })
  const { onInstalled, onClose } = renderInstall()
  const button = await screen.findByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  await screen.findByRole('button', { name: 'plugin.installModal.installing' })
  expect(
    screen.getByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
  ).toBeInTheDocument()
  expect(onInstalled).not.toHaveBeenCalled()
  expect(install).toHaveBeenCalledTimes(3)
  pending.resolve({ all_installed: false, task_id: 'running-task' })
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(
    screen.getByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(checkTask).toHaveBeenCalledExactlyOnceWith('running-task')
  expect(onInstalled).toHaveBeenCalledWith(
    expect.arrayContaining(plugins.map(({ plugin_id }) => expect.objectContaining({ plugin_id }))),
    [
      { success: true, isFromMarketPlace: true },
      { success: false, isFromMarketPlace: true },
      { success: true, isFromMarketPlace: true },
    ],
    plugins.map(() => ({
      hasInstalled: false,
      installedVersion: undefined,
      toInstallVersion: '1.0.0',
    })),
  )
  await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
  expect(onClose).toHaveBeenCalledOnce()
})

it('reports failed requests without polling or refreshing installed plugins', async () => {
  const user = userEvent.setup()
  installRequest.mockRejectedValue(new Error('Installation rejected'))
  const { onInstalled } = renderInstall()
  const button = await screen.findByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(onInstalled).toHaveBeenCalledWith(
    expect.any(Array),
    plugins.map(() => ({ success: false, isFromMarketPlace: true })),
    expect.any(Array),
  )
  expect(checkTask).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'plugin.installModal.install' }),
  ).not.toBeInTheDocument()
})

it('installs only selected plugins and refreshes the catalog after immediate success', async () => {
  const user = userEvent.setup()
  const install = installRequest.mockResolvedValue({ all_installed: true, task_id: '' })
  const { onInstalled } = renderInstall()
  const button = await screen.findByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(screen.getByRole('checkbox', { name: 'common.operation.deSelectAll' }))
  expect(button).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: 'finished' }))
  await user.click(button)
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: [plugins[0]!.latest_package_identifier] },
  })
  expect(refresh).toHaveBeenCalledWith(undefined, true)
  expect(checkTask).not.toHaveBeenCalled()
})

it.each(['common.operation.cancel', 'common.operation.close'])(
  'allows %s before plugin metadata is ready without starting installation',
  async (name) => {
    const user = userEvent.setup()
    marketplace.mockReturnValue(new Promise(() => {}))
    const { onClose, onInstalled } = renderInstall()
    expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(installRequest).not.toHaveBeenCalled()
    expect(onInstalled).not.toHaveBeenCalled()
  },
)

const packageDependency: PackageDependency = {
  type: 'package',
  value: {
    unique_identifier: 'test/local:2.0.0',
    manifest: createPluginDeclarationFixture({
      author: 'test',
      name: 'local',
      version: '2.0.0',
      label: { ...createPluginDeclarationFixture().label, en_US: 'Local plugin' },
    }),
  },
}
const githubDependency: Dependency = {
  type: 'github',
  value: { repo: 'test/github', release: 'v3.0.0', packages: 'plugin.difypkg' },
}

it('keeps mixed-source results and version changes aligned with their dependencies', async () => {
  const user = userEvent.setup()
  marketplace.mockResolvedValue({ data: { list: [{ plugin: plugins[0] }] } })
  const installed = createPluginEntity({
    plugin_id: 'test/finished',
    plugin_unique_identifier: 'test/finished:0.9.0',
  })
  installed.declaration.version = '0.9.0'
  installedPlugins.mockResolvedValue({ plugins: [installed] })
  uploadGithub.mockResolvedValue({
    unique_identifier: 'test/github:3.0.0',
    manifest: createPluginDeclarationFixture({
      author: 'test',
      name: 'github',
      version: '3.0.0',
      label: { ...createPluginDeclarationFixture().label, en_US: 'GitHub plugin' },
    }),
  })
  installPackage.mockResolvedValue({ all_installed: true, task_id: '' })
  upgrade.mockResolvedValue({ all_installed: true, task_id: '' })
  installGithub.mockRejectedValue(new Error('Package rejected'))
  const { onInstalled } = renderInstall([packageDependency, dependencies[0]!, githubDependency])
  const button = screen.getByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  for (const name of ['local', 'finished', 'github']) {
    expect(screen.getByRole('checkbox', { name })).toBeChecked()
  }
  await user.click(button)
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(installPackage).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['test/local:2.0.0'] },
  })
  expect(installGithub).toHaveBeenCalledExactlyOnceWith({
    body: {
      repo: 'test/github',
      version: 'v3.0.0',
      package: 'plugin.difypkg',
      plugin_unique_identifier: 'test/github:3.0.0',
    },
  })
  expect(upgrade).toHaveBeenCalledExactlyOnceWith({
    body: {
      original_plugin_unique_identifier: 'test/finished:0.9.0',
      new_plugin_unique_identifier: 'test/finished:1.0.0',
    },
  })
  expect(installRequest).not.toHaveBeenCalled()
  expect(onInstalled).toHaveBeenCalledWith(
    [
      expect.objectContaining({ name: 'local' }),
      expect.objectContaining({ name: 'finished' }),
      expect.objectContaining({ name: 'github' }),
    ],
    [
      { success: true, isFromMarketPlace: false },
      { success: true, isFromMarketPlace: true },
      { success: false, isFromMarketPlace: false },
    ],
    [
      { hasInstalled: false, installedVersion: undefined, toInstallVersion: '2.0.0' },
      { hasInstalled: true, installedVersion: '0.9.0', toInstallVersion: '1.0.0' },
      { hasInstalled: false, installedVersion: undefined, toInstallVersion: '3.0.0' },
    ],
  )
  expect(screen.getByText('0.9.0 -> 1.0.0')).toBeInTheDocument()
  expect(screen.getByText('2.0.0')).toBeInTheDocument()
  expect(screen.getByText('3.0.0')).toBeInTheDocument()
})

it('excludes failed metadata loads from selection and installs the remaining package', async () => {
  const user = userEvent.setup()
  marketplace.mockRejectedValue(new Error('Marketplace unavailable'))
  uploadGithub.mockRejectedValue(new Error('GitHub unavailable'))
  installPackage.mockResolvedValue({ all_installed: true, task_id: '' })
  const { onInstalled } = renderInstall([dependencies[0]!, githubDependency, packageDependency])
  await waitFor(() =>
    expect(screen.getAllByText('plugin.installModal.pluginLoadError')).toHaveLength(2),
  )
  const button = screen.getByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  expect(screen.getByRole('checkbox', { name: 'local' })).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'common.operation.deSelectAll' }))
  expect(button).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
  await user.click(button)
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(onInstalled).toHaveBeenCalledWith(
    [expect.objectContaining({ name: 'local' })],
    [{ success: true, isFromMarketPlace: false }],
    [{ hasInstalled: false, installedVersion: undefined, toInstallVersion: '2.0.0' }],
  )
  expect(installPackage).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['test/local:2.0.0'] },
  })
  expect(installRequest).not.toHaveBeenCalled()
  expect(installGithub).not.toHaveBeenCalled()
})

it('excludes restricted plugins when selecting all and prevents selecting them individually', async () => {
  const user = userEvent.setup()
  marketplace.mockResolvedValue({
    data: {
      list: [
        { plugin: { ...plugins[0], verification: { authorized_category: 'langgenius' } } },
        { plugin: plugins[1] },
      ],
    },
  })
  installRequest.mockResolvedValue({ all_installed: true, task_id: '' })
  const { onInstalled } = renderInstall(dependencies.slice(0, 2), {
    systemFeatures: {
      enable_marketplace: true,
      plugin_installation_permission: {
        plugin_installation_scope: 'official_only',
        restrict_to_marketplace_only: false,
      },
    },
  })
  const button = screen.getByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  const restricted = screen.getByRole('checkbox', { name: 'failed' })
  expect(restricted).toHaveAttribute('aria-disabled', 'true')
  await user.click(restricted)
  expect(restricted).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'finished' })).toBeChecked()
  await user.click(button)
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(installRequest).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['test/finished:1.0.0'] },
  })
})
