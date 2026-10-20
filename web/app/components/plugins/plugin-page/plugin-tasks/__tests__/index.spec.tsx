import type { PluginStatus, PluginTask } from '@/app/components/plugins/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PermissionType, PluginSource, TaskStatus } from '@/app/components/plugins/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import PluginTasks from '../index'

const requests = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn(), refresh: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.tasks.get': requests.list,
      'workspaces.current.plugin.tasks.byTaskId.delete.byIdentifier.post': requests.clear,
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      }),
    }),
  }
})
// Refreshing unrelated catalogs has its own service tests.
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: requests.refresh }),
}))

const plugin = (name: string, status: TaskStatus, message = ''): PluginStatus => ({
  plugin_unique_identifier: `test/${name}:1.0.0`,
  plugin_id: `test/${name}`,
  source: PluginSource.marketplace,
  status,
  message,
  icon: 'test-icon.png',
  labels: { en_US: name },
  taskId: 'task-1',
})
let tasks: PluginTask[]
const task = (plugins: PluginStatus[], id = 'task-1'): PluginTask => ({
  id,
  plugins,
  created_at: '',
  updated_at: '',
  status: plugins.some((p) => p.status === TaskStatus.running || p.status === TaskStatus.pending)
    ? TaskStatus.running
    : plugins.some((p) => p.status === TaskStatus.failed)
      ? TaskStatus.failed
      : TaskStatus.success,
  total_plugins: plugins.length,
  completed_plugins: plugins.filter((p) => p.status === TaskStatus.success).length,
})
const render = () =>
  renderWithConsoleQuery(<PluginTasks />, { workspacePermissionKeys: ['plugin.install'] })

beforeEach(() => {
  vi.clearAllMocks()
  tasks = []
  requests.list.mockImplementation(async () => ({ tasks }))
  requests.clear.mockImplementation(
    async ({ params }: { params: { task_id: string; identifier: string } }) => {
      tasks = tasks
        .map((t) =>
          t.id === params.task_id
            ? task(
                t.plugins.filter((p) => p.plugin_unique_identifier !== params.identifier),
                t.id,
              )
            : t,
        )
        .filter((t) => t.plugins.length > 0)
      return {}
    },
  )
})

describe('plugin installation tasks', () => {
  it('hides the task trigger after an empty server response', async () => {
    const { queryClient } = render()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(requests.list).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    { statuses: [TaskStatus.pending, TaskStatus.running], tip: 'installing', badge: null },
    {
      statuses: [TaskStatus.running, TaskStatus.success],
      tip: 'installingWithSuccess',
      badge: null,
    },
    {
      statuses: [TaskStatus.running, TaskStatus.failed],
      tip: 'installingWithError',
      badge: 'error',
    },
    { statuses: [TaskStatus.success], tip: 'installSuccess', badge: 'success' },
    { statuses: [TaskStatus.success, TaskStatus.failed], tip: 'installedError', badge: 'error' },
  ])('announces $tip and opens the actual task list', async ({ statuses, tip, badge }) => {
    const user = userEvent.setup()
    tasks = [task(statuses.map((status, index) => plugin(`Plugin ${index}`, status)))]
    render()
    const trigger = await screen.findByRole('button', {
      name: new RegExp(`^plugin\\.task\\.${tip}(?::|$)`),
    })
    if (badge) expect(screen.getByTestId(`task-status-${badge}-badge`)).toBeInTheDocument()
    else {
      expect(screen.queryByTestId('task-status-success-badge')).not.toBeInTheDocument()
      expect(screen.queryByTestId('task-status-error-badge')).not.toBeInTheDocument()
    }
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    for (const [index] of statuses.entries())
      expect(await screen.findByText(`Plugin ${index}`)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  })

  it.each([
    { status: TaskStatus.success, tip: 'installSuccess', message: 'plugin.task.installed' },
    { status: TaskStatus.failed, tip: 'installedError', message: 'Network error' },
  ])(
    'updates an open task list when installation ends with $status',
    async ({ status, tip, message }) => {
      const user = userEvent.setup()
      tasks = [task([plugin('Search plugin', TaskStatus.running, 'Downloading package')])]
      const { queryClient } = render()
      await user.click(await screen.findByRole('button', { name: 'plugin.task.installing' }))
      expect(await screen.findByText('Downloading package')).toBeInTheDocument()
      tasks = [task([plugin('Search plugin', status, status === TaskStatus.failed ? message : '')])]
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['plugins', 'pluginTaskList'] })
      })
      expect(
        await screen.findByRole('button', { name: new RegExp(`^plugin\\.task\\.${tip}(?::|$)`) }),
      ).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(screen.queryByText('Downloading package')).not.toBeInTheDocument()
    },
  )

  it('clears only failed plugins across tasks and keeps running and successful entries visible', async () => {
    const user = userEvent.setup()
    tasks = [
      task([
        plugin('Running', TaskStatus.running),
        plugin('Installed', TaskStatus.success),
        plugin('Failed A', TaskStatus.failed, 'Error A'),
      ]),
      task(
        [plugin('Pending', TaskStatus.pending), plugin('Failed B', TaskStatus.failed, 'Error B')],
        'task-2',
      ),
    ]
    render()
    await user.click(
      await screen.findByRole('button', { name: /^plugin\.task\.installingWithError(?::|$)/ }),
    )
    expect(
      screen.getByRole('heading', { name: 'plugin.task.runningPlugins (2)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'plugin.task.successPlugins (1)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'plugin.task.errorPlugins (2)' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'plugin.task.errorPlugins plugin.task.clearAll' }),
    )
    await waitFor(() => expect(requests.clear).toHaveBeenCalledTimes(2))
    expect(requests.clear).toHaveBeenCalledWith({
      params: { task_id: 'task-1', identifier: 'test/Failed A:1.0.0' },
    })
    expect(requests.clear).toHaveBeenCalledWith({
      params: { task_id: 'task-2', identifier: 'test/Failed B:1.0.0' },
    })
    await waitFor(() => expect(screen.queryByText('Failed B')).not.toBeInTheDocument())
    expect(screen.queryByText('Failed A')).not.toBeInTheDocument()
    for (const name of ['Running', 'Pending', 'Installed'])
      expect(screen.getByText(name)).toBeInTheDocument()
  })

  it('clears completed successes and failures together and hides the empty menu', async () => {
    const user = userEvent.setup()
    tasks = [task([plugin('Installed', TaskStatus.success), plugin('Failed', TaskStatus.failed)])]
    render()
    await user.click(
      await screen.findByRole('button', { name: /^plugin\.task\.installedError(?::|$)/ }),
    )
    await user.click(
      screen.getByRole('button', { name: 'plugin.task.successPlugins plugin.task.clearAll' }),
    )
    await waitFor(() => expect(screen.queryByText('Installed')).not.toBeInTheDocument())
    expect(requests.clear.mock.calls).toEqual([
      [{ params: { task_id: 'task-1', identifier: 'test/Installed:1.0.0' } }],
      [{ params: { task_id: 'task-1', identifier: 'test/Failed:1.0.0' } }],
    ])
    expect(
      screen.queryByRole('button', { name: /^plugin\.task\.installedError(?::|$)/ }),
    ).not.toBeInTheDocument()
  })

  it('waits for an individual clear request before refreshing and closing the last failure', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<object>()
    requests.clear.mockReturnValueOnce(pending.promise)
    tasks = [task([plugin('Failed', TaskStatus.failed)])]
    render()
    await user.click(
      await screen.findByRole('button', { name: /^plugin\.task\.installedError(?::|$)/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Clear Failed' }))
    expect(requests.clear).toHaveBeenCalledExactlyOnceWith({
      params: { task_id: 'task-1', identifier: 'test/Failed:1.0.0' },
    })
    expect(requests.list).toHaveBeenCalledOnce()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    tasks = []
    pending.resolve({})
    await waitFor(() => expect(requests.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Failed')).not.toBeInTheDocument())
  })
})
