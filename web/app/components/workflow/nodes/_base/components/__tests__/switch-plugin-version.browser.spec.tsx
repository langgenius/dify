import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { consoleClient } from '@/service/console'
import { useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { SwitchPluginVersion } from '../switch-plugin-version'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.workspaces.current.plugin.list.installations.ids.post>(),
  tasks: vi.fn<typeof consoleClient.workspaces.current.plugin.tasks.get>(),
  task: vi.fn<typeof consoleClient.workspaces.current.plugin.tasks.byTaskId.get>(),
  upgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.upgrade.marketplace.post>(),
  versions: vi.fn<() => Promise<PluginVersionsResponse>>(),
}))
// boundary: Control installed versions and the external marketplace upgrade request.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': api.detail,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.upgrade.marketplace.post': api.upgrade,
      'workspaces.current.plugin.tasks.get': api.tasks,
      'workspaces.current.plugin.tasks.byTaskId.get': api.task,
    }),
  }
})
// boundary: Supply available versions from the marketplace API.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    ...actual,
    marketplaceQuery: createTanstackQueryUtils(
      { ...actual.marketplaceClient, pluginVersions: api.versions },
      { path: ['marketplace'] },
    ),
  }
})
const installed = createPluginEntity()
const identifier = (version: string) => `langgenius/plugin-entity:${version}@test`
beforeEach(() => {
  api.detail.mockReset().mockResolvedValue({ plugins: [installed] })
  api.tasks.mockReset().mockResolvedValue({ tasks: [] })
  api.task.mockReset()
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
})
async function setup({ enableMarketplace = true } = {}) {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: enableMarketplace },
    workspacePermissionKeys: ['plugin.install'],
  })
  const view = await render(
    <SwitchPluginVersion
      uniqueIdentifier={installed.plugin_unique_identifier}
      tooltip="Switch to a compatible version"
    />,
    { wrapper },
  )
  return {
    view,
    wrapper,
    queryClient,
    trigger: page.getByRole('button', { name: /switchVersion 1\.0\.0/ }),
  }
}

it('keeps the version badge but cannot switch versions when Marketplace is disabled', async () => {
  const { trigger } = await setup({ enableMarketplace: false })
  await expect.element(trigger).toHaveAttribute('aria-disabled', 'true')
})

it('restores focus to the version menu after cancelling and after installing a version', async () => {
  const result = createDeferred<Awaited<ReturnType<typeof api.upgrade>>>()
  api.upgrade.mockReturnValueOnce(result.promise)
  const { trigger } = await setup()
  const dialog = page.getByRole('dialog')
  const openInstall = async () => {
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    await expect.element(dialog).toBeVisible()
  }
  await openInstall()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await openInstall()
  const confirm = dialog.getByRole('button', {
    name: 'workflowAgent.nodes.agent.installPlugin.install',
  })
  await confirm.click()
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Enter}{Escape}')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.close' }))
    .toBeDisabled()
  await expect
    .element(dialog.getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.cancel' }))
    .toBeDisabled()
  await userEvent.click(document.body, { position: { x: 4, y: 4 }, force: true })
  await expect.element(dialog).toBeVisible()
  expect(api.upgrade).toHaveBeenCalledExactlyOnceWith({
    body: {
      original_plugin_unique_identifier: installed.plugin_unique_identifier,
      new_plugin_unique_identifier: identifier('2.0.0'),
    },
  })
  const detailRequests = api.detail.mock.calls.length
  await act(async () => result.resolve({ all_installed: true, task_id: '' }))
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(api.detail).toHaveBeenCalledTimes(detailRequests + 1)
})

it.each(['success', 'failed'] as const)(
  'waits for the queued upgrade to reach %s before updating the caller',
  async (status) => {
    const task = createDeferred<Awaited<ReturnType<typeof api.task>>>()
    api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'upgrade-job' })
    api.task.mockReturnValueOnce(task.promise)
    const { trigger } = await setup()
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', {
      name: 'workflowAgent.nodes.agent.installPlugin.install',
    })
    await confirm.click()
    await vi.waitFor(() =>
      expect(api.task).toHaveBeenCalledExactlyOnceWith(
        { params: { task_id: 'upgrade-job' } },
        { signal: expect.any(AbortSignal) },
      ),
    )
    const detailRequests = api.detail.mock.calls.length
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()
    await act(async () =>
      task.resolve({
        task: {
          id: 'upgrade-job',
          created_at: '',
          updated_at: '',
          status,
          total_plugins: 1,
          completed_plugins: status === 'success' ? 1 : 0,
          plugins: [
            {
              plugin_id: installed.plugin_id,
              plugin_unique_identifier: identifier('2.0.0'),
              status,
              message: status === 'failed' ? 'Package installation failed' : '',
              icon: '',
              labels: { en_US: 'Plugin' },
            },
          ],
        },
      }),
    )
    if (status === 'failed') {
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent('Package installation failed')
      expect(api.detail).toHaveBeenCalledTimes(detailRequests)
      await confirm.click()
    }
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(api.detail).toHaveBeenCalledTimes(detailRequests + 1)
  },
)

it.each(['failed task', 'missing task ID'] as const)(
  'shows a retryable error for a %s in the start response',
  async (failure) => {
    api.upgrade.mockResolvedValueOnce({
      all_installed: false,
      task_id: '',
      task:
        failure === 'failed task'
          ? {
              id: 'failed-job',
              status: 'failed',
              created_at: '',
              updated_at: '',
              total_plugins: 1,
              completed_plugins: 0,
              plugins: [
                {
                  plugin_id: installed.plugin_id,
                  plugin_unique_identifier: identifier('2.0.0'),
                  status: 'failed',
                  message: 'Package rejected',
                  icon: '',
                  labels: { en_US: 'Plugin' },
                },
              ],
            }
          : null,
    })
    const { trigger } = await setup()
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
      .click()
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(failure === 'failed task' ? 'Package rejected' : 'common.error')
    expect(api.task).not.toHaveBeenCalled()
  },
)

it('stops polling when the last panel unmounts and resumes the same job when another panel opens', async () => {
  const { view, queryClient, wrapper, trigger } = await setup()
  const toolsKey = consoleQuery.workspaces.current.tools.builtin.get.queryKey()
  queryClient.setQueryDefaults(toolsKey, { staleTime: Infinity })
  queryClient.setQueryData(toolsKey, [createToolProviderFixture({ name: 'old tool' })])
  const refreshedTools = vi.fn(async () => [createToolProviderFixture({ name: 'new tool' })])
  function ToolList() {
    const query = useQuery(
      consoleQuery.workspaces.current.tools.builtin.get.queryOptions({ queryFn: refreshedTools }),
    )
    return <span>{query.data?.map((tool) => tool.name).join(', ')}</span>
  }
  const status = createDeferred<Awaited<ReturnType<typeof api.task>>>()
  const resumed = createDeferred<Awaited<ReturnType<typeof api.task>>>()
  api.task.mockReturnValueOnce(status.promise).mockReturnValueOnce(resumed.promise)
  api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'saved-task' })
  await trigger.click()
  await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
  await page
    .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
    .click()
  await vi.waitFor(() => expect(api.task).toHaveBeenCalledOnce())
  const signal = api.task.mock.calls[0]?.[1]?.signal
  await view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => status.reject(signal?.reason))
  await vi.waitFor(() => expect(queryClient.getQueryState(toolsKey)?.isInvalidated).toBe(true))
  expect(refreshedTools).not.toHaveBeenCalled()
  refreshedTools.mockResolvedValueOnce([createToolProviderFixture({ name: 'old tool' })])
  await render(
    <>
      <SwitchPluginVersion uniqueIdentifier={installed.plugin_unique_identifier} />
      <ToolList />
    </>,
    { wrapper },
  )
  await vi.waitFor(() => expect(api.task).toHaveBeenCalledTimes(2))
  expect(api.task.mock.calls[1]?.[0]).toEqual({ params: { task_id: 'saved-task' } })
  await expect.element(page.getByText('old tool')).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: /switchVersion 1\.0\.0/ }))
    .toHaveAttribute('aria-disabled', 'true')
  expect(api.upgrade).toHaveBeenCalledOnce()
  api.detail.mockResolvedValue({ plugins: [createPluginEntity({ version: '2.0.0' })] })
  await act(async () =>
    resumed.resolve({
      task: {
        id: 'saved-task',
        created_at: '',
        updated_at: '',
        status: 'success',
        total_plugins: 1,
        completed_plugins: 1,
        plugins: [
          {
            plugin_id: installed.plugin_id,
            plugin_unique_identifier: identifier('2.0.0'),
            status: 'success',
            message: '',
            icon: '',
            labels: { en_US: 'Plugin' },
          },
        ],
      },
    }),
  )
  await expect.element(page.getByRole('button', { name: /switchVersion 2\.0\.0/ })).toBeVisible()
  await expect.element(page.getByText('new tool')).toBeVisible()
  expect(api.task).toHaveBeenCalledTimes(2)
})

it('keeps one status request while another panel observes the upgrade, and stops after the last leaves', async () => {
  const { view, wrapper, trigger } = await setup()
  const status = createDeferred<Awaited<ReturnType<typeof api.task>>>()
  api.task.mockReturnValueOnce(status.promise)
  api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'shared-task' })
  await trigger.click()
  await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
  await page
    .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
    .click()
  await vi.waitFor(() => expect(api.task).toHaveBeenCalledOnce())
  const signal = api.task.mock.calls[0]?.[1]?.signal
  const otherPanel = await render(
    <SwitchPluginVersion uniqueIdentifier={installed.plugin_unique_identifier} />,
    { wrapper },
  )
  await view.unmount()
  await expect
    .element(page.getByRole('button', { name: /switchVersion 1\.0\.0/ }))
    .toHaveAttribute('aria-disabled', 'true')
  expect(signal?.aborted).toBe(false)
  expect(api.task).toHaveBeenCalledOnce()
  expect(api.upgrade).toHaveBeenCalledOnce()
  await otherPanel.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => status.reject(signal?.reason))
})

it('records a task accepted after navigation without polling until a panel comes back', async () => {
  const { view, wrapper, trigger } = await setup()
  const start = createDeferred<Awaited<ReturnType<typeof api.upgrade>>>()
  api.upgrade.mockReturnValueOnce(start.promise)
  await trigger.click()
  await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
  await page
    .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
    .click()
  await vi.waitFor(() => expect(api.upgrade).toHaveBeenCalledOnce())
  await view.unmount()
  await act(async () => start.resolve({ all_installed: false, task_id: 'late-task' }))
  expect(api.task).not.toHaveBeenCalled()
  api.task.mockResolvedValue({
    task: {
      id: 'late-task',
      status: 'success',
      created_at: '',
      updated_at: '',
      total_plugins: 1,
      completed_plugins: 1,
      plugins: [
        {
          plugin_id: installed.plugin_id,
          plugin_unique_identifier: identifier('2.0.0'),
          status: 'success',
          message: '',
          icon: '',
          labels: { en_US: 'Plugin' },
        },
      ],
    },
  })
  api.detail.mockResolvedValue({ plugins: [createPluginEntity({ version: '2.0.0' })] })
  await render(<SwitchPluginVersion uniqueIdentifier={installed.plugin_unique_identifier} />, {
    wrapper,
  })
  await expect.element(page.getByRole('button', { name: /switchVersion 2\.0\.0/ })).toBeVisible()
  expect(api.task).toHaveBeenCalledExactlyOnceWith(
    { params: { task_id: 'late-task' } },
    { signal: expect.any(AbortSignal) },
  )
  expect(api.upgrade).toHaveBeenCalledOnce()
})

it.each(['task on second page', 'list unavailable'] as const)(
  'retries the original task after a status error (%s)',
  async (scenario) => {
    if (scenario === 'list unavailable')
      api.tasks.mockRejectedValue(new Error('Network unavailable'))
    else {
      const task = {
        id: 'retry-status',
        created_at: '',
        updated_at: '',
        status: 'running' as const,
        total_plugins: 1,
        completed_plugins: 0,
        plugins: [],
      }
      api.tasks
        .mockResolvedValueOnce({
          tasks: Array.from({ length: 100 }, (_, id) => ({ ...task, id: String(id) })),
        })
        .mockResolvedValueOnce({ tasks: [task] })
    }
    api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'retry-status' })
    api.task.mockRejectedValueOnce(new Error('Status unavailable')).mockResolvedValueOnce({
      task: {
        id: 'retry-status',
        status: 'success',
        created_at: '',
        updated_at: '',
        total_plugins: 1,
        completed_plugins: 1,
        plugins: [
          {
            plugin_id: installed.plugin_id,
            plugin_unique_identifier: identifier('2.0.0'),
            status: 'success',
            message: '',
            icon: '',
            labels: { en_US: 'Plugin' },
          },
        ],
      },
    })
    const { trigger } = await setup()
    const open = async () => {
      await trigger.click()
      await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    }
    const confirm = page.getByRole('button', {
      name: 'workflowAgent.nodes.agent.installPlugin.install',
    })
    await open()
    await confirm.click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(
        scenario === 'list unavailable' ? 'Network unavailable' : 'Status unavailable',
      )
    expect(api.task).toHaveBeenCalledOnce()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await trigger.click()
    await expect
      .element(page.getByRole('menuitem', { name: /^0\.5\.0/ }))
      .toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    await confirm.click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(api.upgrade).toHaveBeenCalledOnce()
    expect(api.task.mock.calls.map(([input]) => input.params.task_id)).toEqual([
      'retry-status',
      'retry-status',
    ])
  },
)

it.each([true, false])(
  'uses the installed package to resolve an unavailable task only when its identifier matches (%s)',
  async (matches) => {
    const { trigger } = await setup()
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'unavailable-job' })
    api.task.mockRejectedValueOnce(new Error('Task unavailable'))
    api.detail.mockResolvedValue({
      plugins: [
        createPluginEntity({
          version: '2.0.0',
          plugin_unique_identifier: matches
            ? identifier('2.0.0')
            : 'langgenius/plugin-entity:2.0.0@different-digest',
        }),
      ],
    })
    await page
      .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
      .click()
    if (matches) {
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      await expect
        .element(page.getByRole('button', { name: /switchVersion 2\.0\.0/ }))
        .toHaveFocus()
    } else {
      await expect.element(page.getByRole('alert')).toHaveTextContent('Task unavailable')
    }
    expect(api.upgrade).toHaveBeenCalledOnce()
  },
)

it('allows a new upgrade when the accepted task was removed and the target is not installed', async () => {
  const { trigger } = await setup()
  api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'removed' })
  api.task.mockRejectedValue(new Error('Task unavailable'))
  const confirm = page.getByRole('button', {
    name: 'workflowAgent.nodes.agent.installPlugin.install',
  })
  await trigger.click()
  await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
  await confirm.click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Task unavailable')
  await userEvent.keyboard('{Escape}')
  await trigger.click()
  await page.getByRole('menuitem', { name: /^0\.5\.0/ }).click()
  await confirm.click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(api.upgrade).toHaveBeenCalledTimes(2)
  expect(api.upgrade.mock.calls[1]?.[0].body.new_plugin_unique_identifier).toBe(identifier('0.5.0'))
  expect(api.task).toHaveBeenCalledOnce()
})
