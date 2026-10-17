import type { UpdateFromGitHubPayload, UpdateFromMarketPlacePayload } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { PluginCategoryEnum, PluginSource } from '../../types'
import UpdatePlugin from '../index'

const { uploadGitHub, updateFromGitHub, updateFromMarketPlace } = vi.hoisted(() => ({
  uploadGitHub: vi.fn(),
  updateFromGitHub: vi.fn(),
  updateFromMarketPlace: vi.fn(),
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uploadGitHub,
  updateFromGitHub,
  updateFromMarketPlace,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
    }),
  }
})
// Model/tool catalog refresh is covered by its own hook tests.
vi.mock('../../install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

const github: UpdateFromGitHubPayload = {
  originalPackageInfo: {
    id: 'github-original-id',
    repo: 'owner/repo',
    version: 'v1.0.0',
    package: 'plugin.difypkg',
    releases: [
      {
        tag_name: 'v1.0.0',
        assets: [
          {
            id: 1,
            name: 'plugin.difypkg',
            browser_download_url:
              'https://github.com/owner/repo/releases/download/v1.0.0/plugin.difypkg',
          },
        ],
      },
      {
        tag_name: 'v2.0.0',
        assets: [
          {
            id: 2,
            name: 'plugin.difypkg',
            browser_download_url:
              'https://github.com/owner/repo/releases/download/v2.0.0/plugin.difypkg',
          },
        ],
      },
    ],
  },
}
const marketPlace: UpdateFromMarketPlacePayload = {
  category: PluginCategoryEnum.tool,
  originalPackageInfo: { id: 'marketplace-original-id', payload: createPluginDeclarationFixture() },
  targetPackageInfo: { id: 'marketplace-target-id', version: '2.0.0' },
}

beforeEach(() => vi.resetAllMocks())

it('updates a GitHub plugin using the selected release and the existing installation identifier', async () => {
  const user = userEvent.setup()
  uploadGitHub.mockResolvedValueOnce({
    unique_identifier: 'github-target-id',
    manifest: createPluginDeclarationFixture({ version: '2.0.0' }),
  })
  updateFromGitHub.mockResolvedValueOnce({ all_installed: true, task_id: '' })
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <UpdatePlugin
      type={PluginSource.github}
      category={PluginCategoryEnum.tool}
      github={github}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )

  await user.click(screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }))
  expect(await screen.findByRole('option', { name: /v1\.0\.0.*INSTALLED/ })).toBeInTheDocument()
  await user.click(await screen.findByRole('option', { name: 'v2.0.0' }))
  expect(
    screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
  ).toHaveTextContent('v1.0.0 -> v2.0.0')
  expect(screen.queryByRole('button', { name: 'plugin.installModal.back' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }))
  await user.click(await screen.findByRole('option', { name: 'plugin.difypkg' }))
  await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))
  const install = await screen.findByRole('button', { name: 'plugin.installModal.install' })
  expect(uploadGitHub).toHaveBeenCalledExactlyOnceWith('owner/repo', 'v2.0.0', 'plugin.difypkg')
  await user.click(install)
  await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installedSuccessfully' })

  expect(updateFromGitHub).toHaveBeenCalledExactlyOnceWith(
    'owner/repo',
    'v2.0.0',
    'plugin.difypkg',
    'github-original-id',
    'github-target-id',
  )
  expect(onSave).toHaveBeenCalledOnce()
  expect(onCancel).not.toHaveBeenCalled()
  expect(updateFromMarketPlace).not.toHaveBeenCalled()
})

it('routes a marketplace update to its package identifiers and completion callback', async () => {
  const user = userEvent.setup()
  updateFromMarketPlace.mockResolvedValueOnce({ all_installed: true, task_id: '' })
  const onSave = vi.fn()
  render(
    <UpdatePlugin
      type={PluginSource.marketplace}
      category={PluginCategoryEnum.tool}
      marketPlace={marketPlace}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  )
  expect(screen.getByText('1.0.0 -> 2.0.0')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  expect(updateFromMarketPlace).toHaveBeenCalledExactlyOnceWith({
    original_plugin_unique_identifier: 'marketplace-original-id',
    new_plugin_unique_identifier: 'marketplace-target-id',
  })
  expect(updateFromGitHub).not.toHaveBeenCalled()
})
