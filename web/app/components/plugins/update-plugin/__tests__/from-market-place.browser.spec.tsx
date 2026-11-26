import type { PluginInstallTaskStartResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { UpdateFromMarketPlacePayload } from '@/app/components/plugins/types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import PluginTasks from '@/app/components/plugins/plugin-page/plugin-tasks'
import { PluginCategoryEnum, PluginSource, TaskStatus } from '@/app/components/plugins/types'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import MarketplaceUpdateDialog from '../from-market-place'

const payload = (downgrade = false): UpdateFromMarketPlacePayload => ({
  category: PluginCategoryEnum.tool,
  originalPackageInfo: {
    id: 'plugin@1.0.0',
    payload: createPluginDeclarationFixture({ version: '1.0.0', icon: '' }),
  },
  targetPackageInfo: {
    id: downgrade ? 'plugin@0.9.0' : 'plugin@2.0.0',
    version: downgrade ? '0.9.0' : '2.0.0',
  },
})
async function renderUpdate(warnAboutAutoUpdate = false) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.install'],
  })
  function Owner() {
    const [open, setOpen] = useState(true)
    const [refreshed, setRefreshed] = useState(false)
    return (
      <>
        {refreshed && <p>Plugin list refreshed</p>}
        <PluginTasks />
        <MarketplaceUpdateDialog
          open={open}
          onClose={() => setOpen(false)}
          payload={payload(warnAboutAutoUpdate)}
          pluginId="plugin-1"
          onRefresh={() => setRefreshed(true)}
          warnAboutAutoUpdate={warnAboutAutoUpdate}
        />
        <AppToaster />
      </>
    )
  }
  return render(
    <Wrapper>
      <Owner />
    </Wrapper>,
  )
}
const upgrade = () => page.getByRole('button', { name: 'plugin.upgrade.upgrade' })
const warning = () => page.getByRole('alertdialog')
function installPluginApi() {
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          plugin: {
            upgrade: {
              marketplace: { post: () => ({ all_installed: true, task_id: '' }) },
            },
            autoUpgrade: { exclude: { post: () => ({ success: true }) } },
            tasks: { get: () => ({ tasks: [] }) },
          },
          models: { modelTypes: { byModelType: { get: () => ({ data: [] }) } } },
        },
      },
    },
  })
  onTestFinished(fake)
  return fake.console.workspaces.current.plugin
}
let pluginApi: ReturnType<typeof installPluginApi>
beforeEach(() => {
  pluginApi = installPluginApi()
})
afterEach(() => {
  toast.dismiss()
})

it('shows an immediate task failure and lets the user retry successfully', async () => {
  pluginApi.upgrade.marketplace.post.mockResolvedValueOnce({
    all_installed: false,
    task_id: 'failed-upgrade',
    task: {
      id: 'failed-upgrade',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
      status: TaskStatus.failed,
      total_plugins: 1,
      completed_plugins: 0,
      plugins: [
        {
          plugin_id: 'plugin',
          plugin_unique_identifier: 'plugin@2.0.0',
          status: TaskStatus.failed,
          message: 'Upgrade failed',
          icon: '',
          labels: { en_US: 'Test Plugin' },
          source: PluginSource.marketplace,
        },
      ],
    },
  } satisfies PluginInstallTaskStartResponse)
  await renderUpdate()
  await upgrade().click()
  await expect.element(page.getByText('Upgrade failed', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Plugin list refreshed')).not.toBeInTheDocument()
  // The failure toast is also a dialog; name the upgrade dialog so the query does not wait for it to close.
  const dialog = page.getByRole('dialog', { name: 'plugin.upgrade.title' })
  await expect.element(dialog).toBeVisible()
  await upgrade().click()
  await expect.element(page.getByText('Plugin list refreshed')).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('waits for exclusion before downgrading and keeps the warning modal locked until completion', async () => {
  const pending = createDeferred<PluginInstallTaskStartResponse>()
  const exclusion = hold(pluginApi.autoUpgrade.exclude.post)
  pluginApi.upgrade.marketplace.post.mockReturnValueOnce(pending.promise)
  await renderUpdate(true)
  await page
    .getByRole('button', { name: 'plugin.autoUpdate.pluginDowngradeWarning.exclude' })
    .click()
  await expect.element(page.getByRole('button', { name: 'app.newApp.Cancel' })).toBeDisabled()
  await expect
    .poll(() => pluginApi.autoUpgrade.exclude.post)
    .toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { plugin_id: 'plugin-1', category: PluginCategoryEnum.tool },
      }),
    )
  expect(pluginApi.upgrade.marketplace.post).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await expect.element(warning()).toBeVisible()
  exclusion.resolve({ success: true })
  await expect.poll(() => pluginApi.upgrade.marketplace.post.mock.calls.length).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(warning()).toBeVisible()
  pending.resolve({ all_installed: true, task_id: '' })
  await expect.element(warning()).not.toBeInTheDocument()
  await expect.element(page.getByText('Plugin list refreshed')).toBeVisible()
  expect(pluginApi.upgrade.marketplace.post).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      body: {
        original_plugin_unique_identifier: 'plugin@1.0.0',
        new_plugin_unique_identifier: 'plugin@0.9.0',
      },
    }),
  )
})

it('downgrades without excluding future automatic upgrades when that action is chosen', async () => {
  await renderUpdate(true)
  await page
    .getByRole('button', { name: 'plugin.autoUpdate.pluginDowngradeWarning.downgrade' })
    .click()
  await expect.element(warning()).not.toBeInTheDocument()
  await expect.element(page.getByText('Plugin list refreshed')).toBeVisible()
  expect(pluginApi.autoUpgrade.exclude.post).not.toHaveBeenCalled()
  expect(pluginApi.upgrade.marketplace.post).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      body: {
        original_plugin_unique_identifier: 'plugin@1.0.0',
        new_plugin_unique_identifier: 'plugin@0.9.0',
      },
    }),
  )
})

it('hands an accepted installation to the real background task list without claiming completion', async () => {
  const pending = createDeferred<PluginInstallTaskStartResponse>()
  pluginApi.upgrade.marketplace.post.mockReturnValueOnce(pending.promise)
  await renderUpdate(true)
  const submit = page.getByRole('button', {
    name: 'plugin.autoUpdate.pluginDowngradeWarning.downgrade',
  })
  await submit.click()
  await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
  const bounds = submit.element().getBoundingClientRect()
  await userEvent.pointer({
    keys: '[MouseLeft]',
    coords: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  })
  pending.resolve({
    all_installed: false,
    task_id: 'upgrade-task',
    task: {
      id: 'upgrade-task',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
      status: TaskStatus.running,
      total_plugins: 1,
      completed_plugins: 0,
      plugins: [
        {
          plugin_id: 'plugin',
          plugin_unique_identifier: 'plugin@0.9.0',
          status: TaskStatus.running,
          message: 'Downloading plugin',
          icon: '',
          labels: { en_US: 'Test Plugin' },
          source: PluginSource.marketplace,
        },
      ],
    },
  })
  await expect.element(warning()).not.toBeInTheDocument()
  await expect.element(page.getByText('Plugin list refreshed')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'plugin.task.installing' }).click()
  await expect.element(page.getByText('Test Plugin', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Downloading plugin', { exact: true })).toBeVisible()
  expect(pluginApi.upgrade.marketplace.post).toHaveBeenCalledOnce()
})

it('keeps a rejected upgrade available for retry and closes only after success', async () => {
  pluginApi.upgrade.marketplace.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'UPGRADE_FAILED', message: 'Upgrade request failed' }),
  )
  await renderUpdate()
  await upgrade().click()
  await expect.element(upgrade()).toBeEnabled()
  await expect.element(page.getByText('Plugin list refreshed')).not.toBeInTheDocument()
  await upgrade().click()
  await expect.element(page.getByText('Plugin list refreshed')).toBeVisible()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(pluginApi.upgrade.marketplace.post).toHaveBeenCalledTimes(2)
})
