import type { Dependency, PluginDeclaration } from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { PluginCategoryEnum } from '../../../types'
import InstallFromLocalPackage from '../index'

const {
  mockCheckTaskStatus,
  mockHandleInstallTaskStart,
  mockInstallOrUpdate,
  mockInstalledInfo,
  mockInstallPackageFromLocal,
  mockRefreshPluginList,
  mockStopTaskCheck,
  mockUninstallPlugin,
  mockUploadFile,
} = vi.hoisted(() => ({
  mockCheckTaskStatus: vi.fn(),
  mockHandleInstallTaskStart: vi.fn(),
  mockInstallOrUpdate: vi.fn(),
  mockInstalledInfo: {},
  mockInstallPackageFromLocal: vi.fn(),
  mockRefreshPluginList: vi.fn(),
  mockStopTaskCheck: vi.fn(),
  mockUninstallPlugin: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/service/plugins', () => ({
  uninstallPlugin: mockUninstallPlugin,
  uploadFile: mockUploadFile,
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByInfo: () => ({
    isLoading: false,
    data: { data: { list: [] } },
    error: null,
  }),
  useInstallOrUpdate: () => ({ mutate: mockInstallOrUpdate, isPending: false }),
  useInstallPackageFromLocal: () => ({ mutateAsync: mockInstallPackageFromLocal }),
  usePluginTaskList: () => ({
    handleInstallTaskStart: mockHandleInstallTaskStart,
    handleRefetch: vi.fn(),
  }),
  useUploadGitHub: () => ({ data: null, error: null }),
}))

vi.mock('../../hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: mockInstalledInfo, isLoading: false }),
}))

vi.mock('../../hooks/use-install-plugin-limit', () => ({
  default: () => ({ canInstall: true, isLoading: false }),
  pluginInstallLimit: () => ({ canInstall: true }),
}))

vi.mock('../../base/check-task-status', () => ({
  default: () => ({ check: mockCheckTaskStatus, stop: mockStopTaskCheck }),
}))

vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanInstallPluginFromMarketplace: () => ({ canInstallPluginFromMarketplace: true }),
}))

vi.mock('@/context/mitt-context', () => ({
  useMittContextSelector: () => vi.fn(),
}))

function createManifest(overrides: Partial<PluginDeclaration> = {}): PluginDeclaration {
  return {
    plugin_unique_identifier: 'acme/local-example:1.0.0',
    version: '1.0.0',
    author: 'acme',
    icon: 'icon.png',
    name: 'Local Example',
    category: PluginCategoryEnum.tool,
    label: { 'en-US': 'Local Example' } as PluginDeclaration['label'],
    description: { 'en-US': 'Local example description' } as PluginDeclaration['description'],
    created_at: '2026-01-01T00:00:00Z',
    resource: {},
    plugins: [],
    verified: true,
    endpoint: { settings: [], endpoints: [] },
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: {} as PluginDeclaration['trigger'],
    ...overrides,
  }
}

function createPackageFile() {
  return new File(['package'], 'local-example.difypkg', {
    type: 'application/octet-stream',
  })
}

function createBundleFile() {
  return new File(['bundle'], 'local-bundle.difybndl', {
    type: 'application/octet-stream',
  })
}

function createPackageDependency(): Dependency {
  return {
    type: 'package',
    value: {
      unique_identifier: 'acme/bundle-example:1.0.0',
      manifest: createManifest({
        plugin_unique_identifier: 'acme/bundle-example:1.0.0',
        name: 'Bundle Example',
        label: { 'en-US': 'Bundle Example' } as PluginDeclaration['label'],
      }),
    },
  }
}

describe('InstallFromLocalPackage', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadFile.mockResolvedValue({
      unique_identifier: 'acme/local-example:1.0.0',
      manifest: createManifest(),
    })
    mockInstallPackageFromLocal.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockCheckTaskStatus.mockResolvedValue({ status: 'success' })
  })

  it('names the dialog and lets the user cancel while the package is uploading', async () => {
    const user = userEvent.setup()
    mockUploadFile.mockReturnValue(new Promise(() => {}))
    render(
      <InstallFromLocalPackage
        file={createPackageFile()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows an upload failure returned by the local package service', async () => {
    mockUploadFile.mockRejectedValue({ response: { message: 'The package archive is invalid' } })
    render(
      <InstallFromLocalPackage
        file={createPackageFile()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.uploadFailed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('The package archive is invalid')).toBeInTheDocument()
    expect(mockInstallPackageFromLocal).not.toHaveBeenCalled()
  })

  it('installs an uploaded package and shows the terminal success state', async () => {
    const user = userEvent.setup()
    render(
      <InstallFromLocalPackage
        file={createPackageFile()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
    ).toBeInTheDocument()
    expect(screen.getByText('plugin.installModal.installedSuccessfullyDesc')).toBeInTheDocument()
    expect(mockInstallPackageFromLocal).toHaveBeenCalledWith('acme/local-example:1.0.0')
    expect(mockRefreshPluginList).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Local Example' }),
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the installation service error visible in the terminal failure state', async () => {
    const user = userEvent.setup()
    mockInstallPackageFromLocal.mockRejectedValue('Local installation was rejected')
    render(
      <InstallFromLocalPackage
        file={createPackageFile()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installFailed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Local installation was rejected')).toBeInTheDocument()
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
  })

  it('uploads a bundle as dependencies and selects its installable plugin', async () => {
    const file = createBundleFile()
    mockUploadFile.mockResolvedValue([createPackageDependency()])
    render(<InstallFromLocalPackage file={file} onClose={onClose} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Bundle Example' })).toBeChecked()
    })
    expect(mockUploadFile).toHaveBeenCalledWith(file, true)
    expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).toBeEnabled()
  })
})
