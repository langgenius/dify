import type { UpdatePluginPayload } from '../../../types'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { hold, installFakeApi } from '@/test/fake-api'
import { PluginCategoryEnum } from '../../../types'
import { GitHubInstallDialog } from '../dialog'

it('keeps a reopened GitHub update and its automatic fold independent of the background update', async () => {
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          // Plugin refreshes reload the workspace model lists.
          models: { modelTypes: { byModelType: { get: () => ({ data: [] }) } } },
          plugin: {
            upgrade: { github: { post: () => ({ all_installed: true, task_id: '' }) } },
            upload: {
              github: {
                post: () => ({
                  unique_identifier: 'github-target-id',
                  manifest: {
                    author: 'Dify',
                    category: 'model',
                    created_at: '2026-06-01T00:00:00Z',
                    description: { en_US: 'Plugin description' },
                    icon: 'icon.svg',
                    label: { en_US: 'Plugin label' },
                    meta: { version: '2.0.0' },
                    name: 'plugin-entity',
                    plugins: {},
                    resource: { memory: 0 },
                    tags: [],
                    version: '2.0.0',
                  },
                }),
              },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const upgrade = fake.console.workspaces.current.plugin.upgrade.github.post
  const first = hold(upgrade)
  const second = hold(upgrade)
  const handle = createDialogHandle<UpdatePluginPayload>()
  const onUpdated = vi.fn()
  const { wrapper } = createConsoleQueryWrapper()
  await render(
    <>
      <button
        onClick={() =>
          handle.openWithPayload({
            category: PluginCategoryEnum.model,
            github: {
              originalPackageInfo: {
                id: 'github-original-id',
                repo: 'owner/repo',
                version: 'v1',
                package: 'plugin.difypkg',
                releases: [
                  {
                    tag_name: 'v2',
                    assets: [
                      {
                        id: 1,
                        name: 'plugin.difypkg',
                        browser_download_url:
                          'https://github.com/owner/repo/releases/download/v2/plugin.difypkg',
                      },
                    ],
                  },
                ],
              },
            },
          })
        }
      >
        Open update
      </button>
      <GitHubInstallDialog handle={handle} onUpdated={onUpdated} />
    </>,
    { wrapper },
  )
  const dialog = page.getByRole('dialog')
  const install = dialog.getByRole('button', { name: 'plugin.installModal.install' })
  async function openRelease() {
    await page.getByRole('button', { name: 'Open update' }).click()
    await dialog.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }).click()
    await page.getByRole('option', { name: 'v2' }).click()
    await dialog.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }).click()
    await page.getByRole('option', { name: 'plugin.difypkg' }).click()
    await dialog.getByRole('button', { name: 'plugin.installModal.next' }).click()
    await expect.element(install).toBeEnabled()
  }

  await openRelease()
  await install.click()
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()

  await openRelease()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await install.click()
  first.resolve({ all_installed: true, task_id: '' })
  await expect.poll(() => onUpdated.mock.calls.length).toBe(1)
  await expect.element(dialog).toBeVisible()
  await vi.advanceTimersByTimeAsync(15_000)
  vi.useRealTimers()
  await expect.element(dialog).not.toBeInTheDocument()
  second.resolve({ all_installed: true, task_id: '' })
  await expect.poll(() => onUpdated.mock.calls.length).toBe(2)
})
