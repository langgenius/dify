import type {
  PluginInstallTaskStartResponse,
  PluginTaskResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { act } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { SwitchPluginVersion } from '../switch-plugin-version'

const installed = createPluginEntity()
const identifier = (version: string) => `langgenius/plugin-entity:${version}@test`
async function setup({ enableMarketplace = true } = {}) {
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          plugin: {
            list: { installations: { ids: { post: () => ({ plugins: [installed] }) } } },
            upgrade: {
              marketplace: {
                post: async (): Promise<PluginInstallTaskStartResponse> => ({
                  all_installed: true,
                  task_id: '',
                }),
              },
            },
            tasks: {
              byTaskId: {
                get: async ({ params }): Promise<PluginTaskResponse> => {
                  throw apiError({ status: 404, message: `Task ${params.task_id} not found` })
                },
              },
            },
          },
        },
      },
    },
    marketplace: {
      pluginVersions: () => ({
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
      }),
    },
  })
  onTestFinished(fake)
  const { plugin } = fake.console.workspaces.current
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: enableMarketplace },
    workspacePermissionKeys: ['plugin.install'],
  })
  await render(
    <SwitchPluginVersion
      uniqueIdentifier={installed.plugin_unique_identifier}
      tooltip="Switch to a compatible version"
    />,
    { wrapper },
  )
  return {
    queryClient,
    trigger: page.getByRole('button', { name: /switchVersion 1\.0\.0/ }),
    detail: plugin.list.installations.ids.post,
    upgrade: plugin.upgrade.marketplace.post,
    task: plugin.tasks.byTaskId.get,
  }
}

it('keeps the version badge but cannot switch versions when Marketplace is disabled', async () => {
  const { trigger } = await setup({ enableMarketplace: false })
  await expect.element(trigger).toHaveAttribute('aria-disabled', 'true')
})

it('restores focus to the version menu after cancelling and after installing a version', async () => {
  const { trigger, detail, upgrade } = await setup()
  const result = hold(upgrade)
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
  // Click whatever the user would hit outside the dialog, so the backdrop receives the press.
  await userEvent.click(document.elementFromPoint(4, 4)!, { position: { x: 4, y: 4 } })
  await expect.element(dialog).toBeVisible()
  expect(upgrade).toHaveBeenCalledExactlyOnceWith({
    body: {
      original_plugin_unique_identifier: installed.plugin_unique_identifier,
      new_plugin_unique_identifier: identifier('2.0.0'),
    },
  })
  const detailRequests = detail.mock.calls.length
  await act(async () => result.resolve({ all_installed: true, task_id: '' }))
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(detail).toHaveBeenCalledTimes(detailRequests + 1)
})

it.each(['success', 'failed'] as const)(
  'waits for the queued upgrade to reach %s before refreshing installed tools',
  async (status) => {
    const { queryClient, trigger, detail, upgrade, task } = await setup()
    upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'upgrade-job' })
    const taskResult = hold(task)
    const toolsKey = consoleQuery.workspaces.current.tools.builtin.get.queryKey()
    queryClient.setQueryData(toolsKey, [])
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', {
      name: 'workflowAgent.nodes.agent.installPlugin.install',
    })
    await confirm.click()
    await vi.waitFor(() =>
      expect(task).toHaveBeenCalledExactlyOnceWith({ params: { task_id: 'upgrade-job' } }),
    )
    const detailRequests = detail.mock.calls.length
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()
    await act(async () =>
      taskResult.resolve({
        task: {
          id: 'upgrade-job',
          created_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T00:00:00Z',
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
    await expect
      .poll(() => queryClient.getQueryState(toolsKey)?.isInvalidated)
      .toBe(status === 'success')
    if (status === 'failed') {
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent('Package installation failed')
      expect(detail).toHaveBeenCalledTimes(detailRequests)
      await confirm.click()
      await expect.poll(() => upgrade.mock.calls.length).toBe(2)
    }
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.poll(() => detail.mock.calls.length).toBe(detailRequests + 1)
  },
)

it.each(['failed task', 'missing task ID'] as const)(
  'shows a retryable error for a %s in the start response',
  async (failure) => {
    const { trigger, upgrade, task } = await setup()
    upgrade.mockResolvedValueOnce({
      all_installed: false,
      task_id: '',
      task:
        failure === 'failed task'
          ? {
              id: 'failed-job',
              status: 'failed',
              created_at: '2026-06-01T00:00:00Z',
              updated_at: '2026-06-01T00:00:00Z',
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
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
      .click()
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(failure === 'failed task' ? 'Package rejected' : 'common.error')
    expect(task).not.toHaveBeenCalled()
  },
)

it('retries the status of the accepted upgrade inside the same dialog', async () => {
  const { trigger, upgrade, task } = await setup()
  upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'accepted' })
  task
    .mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Connection lost' }),
    )
    .mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Still offline' }),
    )
  await trigger.click()
  await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
    .click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Connection lost')
  await dialog.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Still offline')
  expect(upgrade).toHaveBeenCalledOnce()
  expect(task.mock.calls.map(([input]) => input.params.task_id)).toEqual(['accepted', 'accepted'])

  await userEvent.keyboard('{Escape}')
  await trigger.click()
  await page.getByRole('menuitem', { name: /^0\.5\.0/ }).click()
  await dialog
    .getByRole('button', { name: 'workflowAgent.nodes.agent.installPlugin.install' })
    .click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(upgrade).toHaveBeenCalledTimes(2)
  expect(upgrade).toHaveBeenLastCalledWith({
    body: expect.objectContaining({ new_plugin_unique_identifier: identifier('0.5.0') }),
  })
})
