import type { GitHubRepoReleaseResponse } from '../../types'
import { act } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { fetchReleases } from '../../install-plugin/hooks'
import InstallPluginMenu from '../../plugin-page/install-plugin-menu'
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

function PluginUpdateAction({ name }: { name: string }) {
  return (
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
  )
}

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
          <PluginUpdateAction name={name} />
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

it('discards a pending update check when the user chooses a local install', async () => {
  onTestFinished(guardUnexpectedFetch())
  const release = createDeferred<GitHubRepoReleaseResponse[]>()
  vi.mocked(fetchReleases).mockReturnValueOnce(release.promise)
  const { wrapper } = createConsoleQueryWrapper()
  await render(
    <>
      <PluginUpdateAction name="first" />
      <InstallPluginMenu onSwitchToMarketplaceTab={() => {}} />
    </>,
    { wrapper },
  )
  await page.getByRole('button', { name: 'plugin.action.checkForUpdates' }).click()
  await page.getByRole('button', { name: 'plugin.installPlugin' }).click()
  await page.getByRole('menuitem', { name: 'plugin.source.local' }).click()
  await act(async () => {
    release.resolve([{ tag_name: '2.0.0', assets: [] }])
  })
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('keeps a fresh GitHub install active when an earlier update check resolves', async () => {
  onTestFinished(guardUnexpectedFetch())
  const release = createDeferred<GitHubRepoReleaseResponse[]>()
  vi.mocked(fetchReleases).mockReturnValueOnce(release.promise)
  const { wrapper } = createConsoleQueryWrapper()
  await render(
    <>
      <PluginUpdateAction name="first" />
      <InstallPluginMenu onSwitchToMarketplaceTab={() => {}} />
    </>,
    { wrapper },
  )
  await page.getByRole('button', { name: 'plugin.action.checkForUpdates' }).click()
  const trigger = page.getByRole('button', { name: 'plugin.installPlugin' })
  await trigger.click()
  await page.getByRole('menuitem', { name: 'plugin.source.github' }).click()
  const dialog = page.getByRole('dialog')
  await expect.element(dialog.getByRole('textbox')).toHaveFocus()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await act(async () => {
    release.resolve([{ tag_name: '2.0.0', assets: [] }])
  })
  await expect.element(dialog.getByRole('textbox')).toHaveValue('')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
