import type { PluginManifestInMarket } from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { PluginCategoryEnum, TaskStatus } from '../../../types'
import InstallFromMarketplace from '../index'

const {
  mockCheckTaskStatus,
  mockHandleInstallTaskStart,
  mockInstallPackageFromMarketplace,
  mockRefreshPluginList,
  mockStopTaskCheck,
  mockUpdatePackageFromMarketplace,
} = vi.hoisted(() => ({
  mockCheckTaskStatus: vi.fn(),
  mockHandleInstallTaskStart: vi.fn(),
  mockInstallPackageFromMarketplace: vi.fn(),
  mockRefreshPluginList: vi.fn(),
  mockStopTaskCheck: vi.fn(),
  mockUpdatePackageFromMarketplace: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromMarketPlace: () => ({
    mutateAsync: mockInstallPackageFromMarketplace,
  }),
  usePluginDeclarationFromMarketPlace: () => ({ data: undefined }),
  usePluginTaskList: () => ({ handleInstallTaskStart: mockHandleInstallTaskStart }),
  useUpdatePackageFromMarketPlace: () => ({
    mutateAsync: mockUpdatePackageFromMarketplace,
  }),
}))

vi.mock('../../hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: {}, isLoading: false }),
}))

vi.mock('../../base/check-task-status', () => ({
  default: () => ({ check: mockCheckTaskStatus, stop: mockStopTaskCheck }),
}))

vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

function createManifest(overrides: Partial<PluginManifestInMarket> = {}): PluginManifestInMarket {
  return {
    plugin_unique_identifier: 'acme/marketplace-example:1.0.0',
    name: 'Marketplace Example',
    org: 'acme',
    icon: 'icon.png',
    label: { en_US: 'Marketplace Example' } as PluginManifestInMarket['label'],
    category: PluginCategoryEnum.tool,
    version: '1.0.0',
    latest_version: '1.0.0',
    brief: {
      en_US: 'Marketplace example description',
    } as PluginManifestInMarket['brief'],
    introduction: 'Marketplace example introduction',
    verified: true,
    install_count: 100,
    badges: [],
    verification: { authorized_category: 'community' },
    from: 'marketplace',
    ...overrides,
  }
}

describe('InstallFromMarketplace', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockInstallPackageFromMarketplace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockUpdatePackageFromMarketplace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockCheckTaskStatus.mockResolvedValue({ status: TaskStatus.success })
  })

  it('names the dialog, focuses the safe action, and lets the user cancel', async () => {
    const user = userEvent.setup()
    render(
      <InstallFromMarketplace
        uniqueIdentifier="acme/marketplace-example:1.0.0"
        manifest={createManifest()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toHaveFocus()
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(mockStopTaskCheck).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('installs the marketplace package and closes from the terminal success state', async () => {
    const user = userEvent.setup()
    const manifest = createManifest()
    render(
      <InstallFromMarketplace
        uniqueIdentifier="acme/marketplace-example:1.0.0"
        manifest={manifest}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
    ).toBeInTheDocument()
    expect(screen.getByText('plugin.installModal.installedSuccessfullyDesc')).toBeInTheDocument()
    expect(mockInstallPackageFromMarketplace).toHaveBeenCalledWith('acme/marketplace-example:1.0.0')
    expect(mockHandleInstallTaskStart).toHaveBeenCalledWith({
      all_installed: true,
      task_id: 'task-1',
    })
    expect(mockRefreshPluginList).toHaveBeenCalledWith(manifest)

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('keeps the marketplace service error visible in the terminal failure state', async () => {
    const user = userEvent.setup()
    mockInstallPackageFromMarketplace.mockRejectedValue('Marketplace installation was rejected')
    render(
      <InstallFromMarketplace
        uniqueIdentifier="acme/marketplace-example:1.0.0"
        manifest={createManifest()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installFailed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Marketplace installation was rejected')).toBeInTheDocument()
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
