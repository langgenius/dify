import type { MetaData, PluginCategoryEnum } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { expectLoadingButton } from '@/test/button'
import { renderWithConfigurationModals as render } from '@/test/configuration-modals'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import Action from '../action'

const requests = vi.hoisted(() => ({
  uninstall: vi.fn(),
  releases: vi.fn(),
  uploadGitHub: vi.fn(),
  updateFromGitHub: vi.fn(),
  invalidate: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uninstallPlugin: requests.uninstall,
  uploadGitHub: requests.uploadGitHub,
  updateFromGitHub: requests.updateFromGitHub,
}))
vi.mock('../../install-plugin/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../install-plugin/hooks')>()),
  fetchReleases: requests.releases,
}))
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return { ...actual, toast: Object.assign(requests.notify, actual.toast) }
})
// Catalog refresh is an independent installer contract; the real host, release picker and installer stay mounted.
vi.mock('../../install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
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
vi.mock('@/service/use-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-plugins')>()),
  useInvalidateInstalledPluginList: () => requests.invalidate,
}))

type ActionProps = {
  author: string
  installationId: string
  pluginUniqueIdentifier: string
  pluginName: string
  category: PluginCategoryEnum
  usedInApps: number
  isShowFetchNewVersion: boolean
  isShowInfo: boolean
  isShowDelete: boolean
  onDelete: () => void
  meta?: MetaData
}

const createActionProps = (overrides: Partial<ActionProps> = {}): ActionProps => ({
  author: 'test-author',
  installationId: 'install-123',
  pluginUniqueIdentifier: 'test-author/test-plugin@1.0.0',
  pluginName: 'test-plugin',
  category: 'tool' as PluginCategoryEnum,
  usedInApps: 5,
  isShowFetchNewVersion: false,
  isShowInfo: false,
  isShowDelete: true,
  onDelete: vi.fn(),
  meta: {
    repo: 'test-author/test-plugin',
    version: '1.0.0',
    package: 'test-plugin.difypkg',
  },
  ...overrides,
})

const deleteButton = () => screen.getByRole('button', { name: 'plugin.action.delete' })
const confirmButton = () => screen.getByRole('button', { name: 'common.operation.confirm' })
const updateButton = () => screen.getByRole('button', { name: 'plugin.action.checkForUpdates' })

beforeEach(() => {
  vi.clearAllMocks()
  requests.uninstall.mockResolvedValue({ success: true })
  requests.releases.mockResolvedValue([])
})

describe('installed plugin actions', () => {
  it('hides unavailable actions', () => {
    render(<Action {...createActionProps({ isShowDelete: false })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('identifies the plugin before deletion and allows cancellation', async () => {
    const user = userEvent.setup()
    const props = createActionProps()
    render(<Action {...props} />)
    await user.click(deleteButton())
    expect(screen.getByRole('alertdialog', { name: 'plugin.action.delete' })).toHaveTextContent(
      'test-plugin',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.uninstall).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('deletes the current installation once and refreshes only after the request succeeds', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<{ success: boolean }>()
    requests.uninstall.mockReturnValueOnce(pending.promise)
    const previous = createActionProps({ installationId: 'old-installation' })
    const props = createActionProps({
      installationId: 'new-installation',
      category: 'model' as PluginCategoryEnum,
    })
    const { rerender } = render(<Action {...previous} />)
    rerender(<Action {...props} />)
    await user.click(deleteButton())
    await user.click(confirmButton())
    expectLoadingButton(confirmButton())
    await user.click(confirmButton())
    expect(requests.uninstall).toHaveBeenCalledExactlyOnceWith('new-installation')
    expect(requests.invalidate).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    pending.resolve({ success: true })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.invalidate).toHaveBeenCalledExactlyOnceWith('model')
    expect(props.onDelete).toHaveBeenCalledOnce()
    expect(previous.onDelete).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'unsuccessful'])(
    'keeps the confirmation available for retry after a %s uninstall',
    async (failure) => {
      const user = userEvent.setup()
      const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
      if (failure === 'rejected')
        requests.uninstall.mockRejectedValueOnce(new Error('Network error'))
      else requests.uninstall.mockResolvedValueOnce({ success: false })
      const props = createActionProps()
      render(<Action {...props} />)
      await user.click(deleteButton())
      await user.click(confirmButton())
      await waitFor(() => expect(confirmButton()).not.toHaveAttribute('aria-disabled', 'true'))
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(props.onDelete).not.toHaveBeenCalled()
      expect(requests.invalidate).not.toHaveBeenCalled()
      await user.click(confirmButton())
      await waitFor(() => expect(props.onDelete).toHaveBeenCalledOnce())
      expect(requests.uninstall).toHaveBeenCalledTimes(2)
      logError.mockRestore()
    },
  )

  it('opens repository, release and package information in the real dialog', async () => {
    const user = userEvent.setup()
    render(<Action {...createActionProps({ isShowInfo: true })} />)
    await user.click(screen.getByRole('button', { name: 'plugin.action.pluginInfo' }))
    expect(screen.getByRole('dialog', { name: 'plugin.pluginInfoModal.title' })).toBeInTheDocument()
    expect(screen.getByText('https://github.com/test-author/test-plugin')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByText('test-plugin.difypkg')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('updates the chosen release through the real modal and refreshes after saving', async () => {
    const user = userEvent.setup()
    requests.releases.mockResolvedValue([
      {
        tag_name: '2.0.0',
        assets: [
          {
            id: 2,
            name: 'test-plugin.difypkg',
            browser_download_url:
              'https://github.com/test-author/test-plugin/releases/download/2.0.0/test-plugin.difypkg',
          },
        ],
      },
      { tag_name: '1.0.0', assets: [] },
    ])
    requests.uploadGitHub.mockResolvedValue({
      unique_identifier: 'test-author/test-plugin@2.0.0',
      manifest: createPluginDeclarationFixture({ version: '2.0.0' }),
    })
    const pending = createDeferred<{ all_installed: boolean; task_id: string }>()
    requests.updateFromGitHub.mockReturnValueOnce(pending.promise)
    render(<Action {...createActionProps({ isShowFetchNewVersion: true })} />)
    await user.click(updateButton())
    expect(
      await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.updatePlugin' }),
    ).toBeVisible()
    expect(requests.releases).toHaveBeenCalledExactlyOnceWith('test-author', 'test-plugin')
    expect(requests.notify).toHaveBeenCalledWith('New version available: 2.0.0', { type: 'info' })
    await user.click(
      screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
    )
    expect(await screen.findByRole('option', { name: /1\.0\.0.*INSTALLED/ })).toBeVisible()
    await user.click(screen.getByRole('option', { name: '2.0.0' }))
    await user.click(
      screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }),
    )
    await user.click(await screen.findByRole('option', { name: 'test-plugin.difypkg' }))
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))
    await user.click(await screen.findByRole('button', { name: 'plugin.installModal.install' }))
    expect(requests.uploadGitHub).toHaveBeenCalledExactlyOnceWith(
      'test-author/test-plugin',
      '2.0.0',
      'test-plugin.difypkg',
    )
    expect(requests.updateFromGitHub).toHaveBeenCalledExactlyOnceWith(
      'test-author/test-plugin',
      '2.0.0',
      'test-plugin.difypkg',
      'test-author/test-plugin@1.0.0',
      'test-author/test-plugin@2.0.0',
    )
    expect(requests.invalidate).not.toHaveBeenCalled()
    pending.resolve({ all_installed: true, task_id: '' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests.invalidate).toHaveBeenCalledExactlyOnceWith('tool')
  })

  it('falls back to plugin identity for incomplete repository metadata and reports an up-to-date version', async () => {
    const user = userEvent.setup()
    requests.releases.mockResolvedValue([{ tag_name: '1.0.0', assets: [] }])
    render(
      <Action
        {...createActionProps({
          isShowFetchNewVersion: true,
          meta: { repo: '/', version: '1.0.0', package: 'plugin.difypkg' },
        })}
      />,
    )
    await user.click(updateButton())
    await waitFor(() =>
      expect(requests.notify).toHaveBeenCalledWith('No new version available', { type: 'info' }),
    )
    expect(requests.releases).toHaveBeenCalledExactlyOnceWith('test-author', 'test-plugin')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not open an update when the repository has no releases', async () => {
    const user = userEvent.setup()
    render(<Action {...createActionProps({ isShowFetchNewVersion: true })} />)
    await user.click(updateButton())
    await waitFor(() => expect(requests.releases).toHaveBeenCalledOnce())
    expect(requests.notify).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
