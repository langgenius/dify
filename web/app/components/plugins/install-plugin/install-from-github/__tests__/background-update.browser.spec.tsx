import type { UpdatePluginPayload } from '../../../types'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { PluginCategoryEnum } from '../../../types'
import { GitHubInstallDialog } from '../dialog'

const { uploadGitHub, updateFromGitHub } = vi.hoisted(() => ({
  uploadGitHub: vi.fn(),
  updateFromGitHub: vi.fn(),
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uploadGitHub,
  updateFromGitHub,
}))
// boundary: Isolate workspace model queries and plugin cache refreshes from the dialog lifecycle.
vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

it('keeps a reopened GitHub update and its automatic fold independent of the background update', async () => {
  onTestFinished(guardUnexpectedFetch())
  const first = createDeferred<{ all_installed: boolean; task_id: string }>()
  const second = createDeferred<{ all_installed: boolean; task_id: string }>()
  updateFromGitHub.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  uploadGitHub.mockResolvedValue({
    unique_identifier: 'github-target-id',
    manifest: createPluginDeclarationFixture({ version: '2.0.0' }),
  })
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
