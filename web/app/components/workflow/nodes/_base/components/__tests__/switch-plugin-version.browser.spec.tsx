import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { consoleClient } from '@/service/console'
import { act } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { SwitchPluginVersion } from '../switch-plugin-version'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.workspaces.current.plugin.list.installations.ids.post>(),
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
  const onChange = vi.fn()
  const { wrapper } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: enableMarketplace },
    workspacePermissionKeys: ['plugin.install'],
  })
  await render(
    <SwitchPluginVersion
      uniqueIdentifier={installed.plugin_unique_identifier}
      tooltip="Switch to a compatible version"
      onChange={onChange}
    />,
    { wrapper },
  )
  return { onChange, trigger: page.getByRole('button', { name: /switchVersion 1\.0\.0/ }) }
}

it('keeps the version badge but cannot switch versions when Marketplace is disabled', async () => {
  const { trigger } = await setup({ enableMarketplace: false })
  await expect.element(trigger).toHaveAttribute('aria-disabled', 'true')
})

it('restores focus to the version menu after cancelling and after installing a version', async () => {
  const result = createDeferred<Awaited<ReturnType<typeof api.upgrade>>>()
  api.upgrade.mockReturnValueOnce(result.promise)
  const { trigger, onChange } = await setup()
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
  expect(onChange).not.toHaveBeenCalled()
  const detailRequests = api.detail.mock.calls.length
  await act(async () => result.resolve({ all_installed: true, task_id: '' }))
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(onChange).toHaveBeenCalledExactlyOnceWith('2.0.0')
  expect(api.detail).toHaveBeenCalledTimes(detailRequests + 1)
})

it.each(['success', 'failed'] as const)(
  'waits for the queued upgrade to reach %s before updating the caller',
  async (status) => {
    const task = createDeferred<Awaited<ReturnType<typeof api.task>>>()
    api.upgrade.mockResolvedValueOnce({ all_installed: false, task_id: 'upgrade-job' })
    api.task.mockReturnValueOnce(task.promise)
    const { trigger, onChange } = await setup()
    await trigger.click()
    await page.getByRole('menuitem', { name: /^2\.0\.0/ }).click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', {
      name: 'workflowAgent.nodes.agent.installPlugin.install',
    })
    await confirm.click()
    await vi.waitFor(() =>
      expect(api.task).toHaveBeenCalledExactlyOnceWith({ params: { task_id: 'upgrade-job' } }),
    )
    const detailRequests = api.detail.mock.calls.length
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()
    expect(onChange).not.toHaveBeenCalled()
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
      expect(onChange).not.toHaveBeenCalled()
      expect(api.detail).toHaveBeenCalledTimes(detailRequests)
      await confirm.click()
    }
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2.0.0')
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
    const { trigger, onChange } = await setup()
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
    expect(onChange).not.toHaveBeenCalled()
  },
)
