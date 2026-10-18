import type { PluginInstallTaskStartResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { UpdateFromMarketPlacePayload } from '@/app/components/plugins/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import MarketplaceUpdateDialog from '../from-market-place'

const {
  mockCheck,
  mockHandleInstallTaskStart,
  mockRemoveAutoUpgrade,
  mockUpdateFromMarketPlace,
  mockToastError,
} = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockHandleInstallTaskStart: vi.fn(),
  mockRemoveAutoUpgrade: vi.fn(),
  mockUpdateFromMarketPlace: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/service/plugins', () => ({
  checkTaskStatus: mockCheck,
}))

vi.mock('@/service/use-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-plugins')>()),
  usePluginTaskList: () => ({
    handleInstallTaskStart: mockHandleInstallTaskStart,
  }),
}))

const createPayload = (
  overrides: Partial<UpdateFromMarketPlacePayload> = {},
): UpdateFromMarketPlacePayload => ({
  category: PluginCategoryEnum.tool,
  originalPackageInfo: {
    id: 'plugin@1.0.0',
    payload: createPluginDeclarationFixture({
      version: '1.0.0',
      icon: 'plugin.png',
    }),
  },
  targetPackageInfo: {
    id: 'plugin@2.0.0',
    version: '2.0.0',
  },
  ...overrides,
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,

    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.upgrade.marketplace.post': mockUpdateFromMarketPlace,
      'workspaces.current.plugin.autoUpgrade.exclude.post': (...args: unknown[]) =>
        mockRemoveAutoUpgrade(...args),
    }),
  }
})

describe('UpdateFromMarketplace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCheck.mockResolvedValue({
      task: { plugins: [{ plugin_unique_identifier: 'plugin@2.0.0', status: TaskStatus.success }] },
    })
    mockUpdateFromMarketPlace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
  })

  it('shows the upgrade failure and lets the user retry successfully', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const failedResponse: PluginInstallTaskStartResponse = {
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
            message: 'upgrade failed',
            icon: 'plugin.png',
            labels: { en_US: 'Test Plugin' },
            source: 'marketplace',
          },
        ],
      },
    }
    mockUpdateFromMarketPlace.mockResolvedValueOnce(failedResponse)

    render(
      <MarketplaceUpdateDialog
        open
        onClose={vi.fn()}
        payload={createPayload()}
        onRefresh={onSave}
        pluginId="plugin-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('upgrade failed')
    })
    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockHandleInstallTaskStart).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  })

  it('waits for auto-upgrade exclusion before downgrading', async () => {
    const user = userEvent.setup()
    const exclusion = createDeferred<object>()
    mockRemoveAutoUpgrade.mockReturnValueOnce(exclusion.promise)
    const onSave = vi.fn()
    const onClose = vi.fn()
    const upgrade = createDeferred<PluginInstallTaskStartResponse>()
    mockUpdateFromMarketPlace.mockReturnValueOnce(upgrade.promise)
    render(
      <MarketplaceUpdateDialog
        open
        onClose={onClose}
        payload={createPayload({ targetPackageInfo: { id: 'plugin@0.9.0', version: '0.9.0' } })}
        pluginId="plugin-1"
        onRefresh={onSave}
        warnAboutAutoUpdate
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'plugin.autoUpdate.pluginDowngradeWarning.exclude' }),
    )

    await waitFor(() => {
      expect(mockRemoveAutoUpgrade).toHaveBeenCalledWith({
        body: {
          plugin_id: 'plugin-1',
          category: PluginCategoryEnum.tool,
        },
      })
    })
    expect(mockUpdateFromMarketPlace).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      'plugin.autoUpdate.pluginDowngradeWarning.description',
    )
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'app.newApp.Cancel' })).toBeDisabled()

    await act(async () => exclusion.resolve({}))

    await waitFor(() => expect(mockUpdateFromMarketPlace).toHaveBeenCalledOnce())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => upgrade.resolve({ all_installed: true, task_id: '' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(mockUpdateFromMarketPlace).toHaveBeenCalledWith({
      body: {
        original_plugin_unique_identifier: 'plugin@1.0.0',
        new_plugin_unique_identifier: 'plugin@0.9.0',
      },
    })
  })
  it('downgrades without excluding future automatic upgrades when that action is chosen', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <MarketplaceUpdateDialog
        open
        onClose={vi.fn()}
        payload={createPayload({ targetPackageInfo: { id: 'plugin@0.9.0', version: '0.9.0' } })}
        pluginId="plugin-1"
        onRefresh={onSave}
        warnAboutAutoUpdate
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'plugin.autoUpdate.pluginDowngradeWarning.downgrade' }),
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(mockUpdateFromMarketPlace).toHaveBeenCalledExactlyOnceWith({
      body: {
        original_plugin_unique_identifier: 'plugin@1.0.0',
        new_plugin_unique_identifier: 'plugin@0.9.0',
      },
    })
    expect(mockRemoveAutoUpgrade).not.toHaveBeenCalled()
  })

  it('waits for the upgrade task before reporting success and prevents duplicate submissions', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<{
      task: { plugins: { plugin_unique_identifier: string; status: TaskStatus }[] }
    }>()
    const response: PluginInstallTaskStartResponse = {
      all_installed: false,
      task_id: 'upgrade-task',
    }
    mockUpdateFromMarketPlace.mockResolvedValueOnce(response)
    mockCheck.mockReturnValueOnce(pending.promise)
    const onSave = vi.fn()
    render(
      <MarketplaceUpdateDialog
        open
        onClose={vi.fn()}
        payload={createPayload()}
        onRefresh={onSave}
        pluginId="plugin-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(mockCheck).toHaveBeenCalledExactlyOnceWith('upgrade-task'))
    const upgrading = screen.getByRole('button', { name: 'plugin.upgrade.upgrading' })
    expect(upgrading).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.queryByRole('button', { name: 'common.operation.cancel' }),
    ).not.toBeInTheDocument()
    await user.click(upgrading)
    expect(mockUpdateFromMarketPlace).toHaveBeenCalledOnce()
    expect(mockHandleInstallTaskStart).toHaveBeenCalledExactlyOnceWith(response)
    expect(onSave).not.toHaveBeenCalled()

    await act(async () =>
      pending.resolve({
        task: {
          plugins: [{ plugin_unique_identifier: 'plugin@2.0.0', status: TaskStatus.success }],
        },
      }),
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  })

  it('allows retrying after an upgrade request rejects', async () => {
    const user = userEvent.setup()
    mockUpdateFromMarketPlace.mockRejectedValueOnce(new Error('Upgrade request failed'))
    const onSave = vi.fn()
    render(
      <MarketplaceUpdateDialog
        open
        onClose={vi.fn()}
        payload={createPayload()}
        onRefresh={onSave}
        pluginId="plugin-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    expect(onSave).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(mockUpdateFromMarketPlace).toHaveBeenCalledTimes(2)
  })

  it('shows a task failure and restores the upgrade action for retry', async () => {
    const user = userEvent.setup()
    mockUpdateFromMarketPlace.mockResolvedValueOnce({
      all_installed: false,
      task_id: 'failed-task',
    })
    mockCheck.mockResolvedValueOnce({
      task: {
        plugins: [
          {
            plugin_unique_identifier: 'plugin@2.0.0',
            status: TaskStatus.failed,
            message: 'Dependency conflict',
          },
        ],
      },
    })
    const onSave = vi.fn()
    render(
      <MarketplaceUpdateDialog
        open
        onClose={vi.fn()}
        payload={createPayload()}
        onRefresh={onSave}
        pluginId="plugin-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Dependency conflict'))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  })
})
