import type { Dependency, Plugin } from '../../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { PermissionType, PluginCategoryEnum, TaskStatus } from '../../../../types'
import Install from '../install'

const { marketplace, checkTask, refresh, installRequest } = vi.hoisted(() => ({
  marketplace: vi.fn(),
  checkTask: vi.fn(),
  refresh: vi.fn(),
  installRequest: vi.fn(),
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
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
  }
})
// Refreshing unrelated model/tool catalogs is independently covered by use-refresh-plugin-list.
vi.mock('../../../hooks/use-refresh-plugin-list', () => ({
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
  marketplace.mockResolvedValue({ data: { list: plugins.map((plugin) => ({ plugin })) } })
})
afterEach(() => vi.restoreAllMocks())

const renderInstall = () => {
  const onInstalled = vi.fn()
  const onStartToInstall = vi.fn()
  renderWithConsoleQuery(
    <Install
      allPlugins={dependencies}
      onInstalled={onInstalled}
      onStartToInstall={onStartToInstall}
      onCancel={vi.fn()}
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
    },
  )
  return { onInstalled, onStartToInstall }
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
  const { onInstalled, onStartToInstall } = renderInstall()
  const button = await screen.findByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  await screen.findByRole('button', { name: 'plugin.installModal.installing' })
  expect(onStartToInstall).toHaveBeenCalledOnce()
  expect(onInstalled).not.toHaveBeenCalled()
  expect(install).toHaveBeenCalledTimes(3)
  pending.resolve({ all_installed: false, task_id: 'running-task' })
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
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
})

it('reports failed requests without polling or refreshing installed plugins', async () => {
  const user = userEvent.setup()
  installRequest.mockRejectedValue(new Error('Installation rejected'))
  const { onInstalled } = renderInstall()
  const button = await screen.findByRole('button', { name: 'plugin.installModal.install' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  await waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  expect(onInstalled.mock.calls[0]![1]).toEqual(
    plugins.map(() => ({ success: false, isFromMarketPlace: true })),
  )
  expect(checkTask).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
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
