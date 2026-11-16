import type { GitHubRepoReleaseResponse } from '../../types'
import { act } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { fetchReleases } from '../../install-plugin/hooks'
import { PluginCategoryEnum } from '../../types'
import Action from '../action'

// boundary: Control when each external GitHub release lookup resolves.
vi.mock('../../install-plugin/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../install-plugin/hooks')>()),
  fetchReleases: vi.fn(),
}))

// boundary: Isolate workspace model queries and plugin cache refreshes from the dialog lifecycle.
vi.mock('../../install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

it('shows only the last card selected when GitHub update checks finish out of order', async () => {
  onTestFinished(guardUnexpectedFetch())
  const first = createDeferred<GitHubRepoReleaseResponse[]>()
  vi.mocked(fetchReleases)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce([{ tag_name: '3.0.0', assets: [] }])
  const { wrapper } = createConsoleQueryWrapper()
  await render(
    <>
      {['first', 'second'].map((name) => (
        <section key={name} aria-label={name}>
          <Action
            author="owner"
            installationId={name}
            pluginUniqueIdentifier={`owner/${name}@1.0.0`}
            pluginName={name}
            category={PluginCategoryEnum.tool}
            usedInApps={0}
            isShowFetchNewVersion
            isShowDelete={false}
            isShowInfo={false}
            onDelete={() => {}}
            meta={{ repo: `owner/${name}`, version: '1.0.0', package: 'plugin.difypkg' }}
          />
        </section>
      ))}
    </>,
    { wrapper },
  )
  for (const name of ['first', 'second']) {
    await page
      .getByRole('region', { name })
      .getByRole('button', { name: 'plugin.action.checkForUpdates' })
      .click()
  }
  const dialog = page.getByRole('dialog')
  await expect.element(dialog).toBeVisible()
  await act(async () => {
    first.resolve([{ tag_name: '2.0.0', assets: [] }])
  })
  await dialog.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }).click()
  await page.getByRole('option', { name: '3.0.0' }).click()
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})
