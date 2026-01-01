import type { PluginDeclaration } from '../../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, TaskStatus } from '../../../types'
import Install from './install'

// Factory function for test data
const createMockManifest = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'test-plugin-uid',
  version: '1.0.0',
  author: 'test-author',
  icon: 'test-icon.png',
  name: 'Test Plugin',
  category: PluginCategoryEnum.tool,
  label: { 'en-US': 'Test Plugin' } as PluginDeclaration['label'],
  description: { 'en-US': 'A test plugin' } as PluginDeclaration['description'],
  created_at: '2024-01-01T00:00:00Z',
  resource: {},
  plugins: [],
  verified: true,
  endpoint: { settings: [], endpoints: [] },
  model: null,
  tags: [],
  agent_strategy: null,
  meta: { version: '1.0.0', minimum_dify_version: '0.8.0' },
  trigger: {} as PluginDeclaration['trigger'],
  ...overrides,
})

// Mock external dependencies
const mockUseCheckInstalled = vi.fn()
vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => mockUseCheckInstalled(),
}))

const mockInstallPackageFromLocal = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromLocal: () => ({
    mutateAsync: mockInstallPackageFromLocal,
  }),
  usePluginTaskList: () => ({
    handleRefetch: vi.fn(),
  }),
}))

const mockUninstallPlugin = vi.fn()
vi.mock('@/service/plugins', () => ({
  uninstallPlugin: (...args: unknown[]) => mockUninstallPlugin(...args),
}))

const mockCheck = vi.fn()
const mockStop = vi.fn()
vi.mock('../../base/check-task-status', () => ({
  default: () => ({
    check: mockCheck,
    stop: mockStop,
  }),
}))

const mockLangGeniusVersionInfo = { current_version: '1.0.0' }
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    langGeniusVersionInfo: mockLangGeniusVersionInfo,
  }),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock(),
    Trans: ({ i18nKey, components }: { i18nKey: string, components?: Record<string, React.ReactNode> }) => (
      <span data-testid="trans">
        {i18nKey}
        {components?.trustSource}
      </span>
    ),
  }
})

vi.mock('../../../card', () => ({
  default: ({ payload, titleLeft }: {
    payload: Record<string, unknown>
    titleLeft?: React.ReactNode
  }) => (
    <div data-testid="card">
      <span data-testid="card-name">{payload?.name as string}</span>
      <div data-testid="card-title-left">{titleLeft}</div>
    </div>
  ),
}))

vi.mock('../../base/version', () => ({
  default: ({ hasInstalled, installedVersion, toInstallVersion }: {
    hasInstalled: boolean
    installedVersion?: string
    toInstallVersion: string
  }) => (
    <div data-testid="version">
      <span data-testid="version-has-installed">{hasInstalled ? 'true' : 'false'}</span>
      <span data-testid="version-installed">{installedVersion || 'null'}</span>
      <span data-testid="version-to-install">{toInstallVersion}</span>
    </div>
  ),
}))

vi.mock('../../utils', () => ({
  pluginManifestToCardPluginProps: (manifest: PluginDeclaration) => ({
    name: manifest.name,
    author: manifest.author,
    version: manifest.version,
  }),
}))

describe('Install', () => {
  const defaultProps = {
    uniqueIdentifier: 'test-unique-identifier',
    payload: createMockManifest(),
    onCancel: vi.fn(),
    onStartToInstall: vi.fn(),
    onInstalled: vi.fn(),
    onFailed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCheckInstalled.mockReturnValue({
      installedInfo: null,
      isLoading: false,
    })
    mockInstallPackageFromLocal.mockReset()
    mockUninstallPlugin.mockReset()
    mockCheck.mockReset()
    mockStop.mockReset()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render ready to install message', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.readyToInstall')).toBeInTheDocument()
    })

    it('should render trust source message', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('trans')).toBeInTheDocument()
    })

    it('should render plugin card', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('card')).toBeInTheDocument()
      expect(screen.getByTestId('card-name')).toHaveTextContent('Test Plugin')
    })

    it('should render cancel button', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })

    it('should render install button', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).toBeInTheDocument()
    })

    it('should show version component when not loading', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: null,
        isLoading: false,
      })

      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('version')).toBeInTheDocument()
    })

    it('should not show version component when loading', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: null,
        isLoading: true,
      })

      render(<Install {...defaultProps} />)

      expect(screen.queryByTestId('version')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Version Display Tests
  // ================================
  describe('Version Display', () => {
    it('should display toInstallVersion from payload', () => {
      const payload = createMockManifest({ version: '2.0.0' })
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: null,
        isLoading: false,
      })

      render(<Install {...defaultProps} payload={payload} />)

      expect(screen.getByTestId('version-to-install')).toHaveTextContent('2.0.0')
    })

    it('should display hasInstalled=false when not installed', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: null,
        isLoading: false,
      })

      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('version-has-installed')).toHaveTextContent('false')
    })

    it('should display hasInstalled=true when already installed', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-author/Test Plugin': {
            installedVersion: '0.9.0',
            installedId: 'installed-id',
            uniqueIdentifier: 'old-uid',
          },
        },
        isLoading: false,
      })

      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('version-has-installed')).toHaveTextContent('true')
      expect(screen.getByTestId('version-installed')).toHaveTextContent('0.9.0')
    })
  })

  // ================================
  // Install Button State Tests
  // ================================
  describe('Install Button State', () => {
    it('should disable install button when loading', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: null,
        isLoading: true,
      })

      render(<Install {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).toBeDisabled()
    })

    it('should enable install button when not loading', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: null,
        isLoading: false,
      })

      render(<Install {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.install' })).not.toBeDisabled()
    })
  })

  // ================================
  // Cancel Button Tests
  // ================================
  describe('Cancel Button', () => {
    it('should call onCancel and stop when cancel button is clicked', () => {
      const onCancel = vi.fn()
      render(<Install {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(mockStop).toHaveBeenCalled()
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should hide cancel button when installing', async () => {
      mockInstallPackageFromLocal.mockImplementation(() => new Promise(() => {}))

      render(<Install {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'common.operation.cancel' })).not.toBeInTheDocument()
      })
    })
  })

  // ================================
  // Installation Flow Tests
  // ================================
  describe('Installation Flow', () => {
    it('should call onStartToInstall when install button is clicked', async () => {
      mockInstallPackageFromLocal.mockResolvedValue({
        all_installed: true,
        task_id: 'task-123',
      })

      const onStartToInstall = vi.fn()
      render(<Install {...defaultProps} onStartToInstall={onStartToInstall} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(onStartToInstall).toHaveBeenCalledTimes(1)
      })
    })

    it('should call onInstalled when all_installed is true', async () => {
      mockInstallPackageFromLocal.mockResolvedValue({
        all_installed: true,
        task_id: 'task-123',
      })

      const onInstalled = vi.fn()
      render(<Install {...defaultProps} onInstalled={onInstalled} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(onInstalled).toHaveBeenCalled()
      })
    })

    it('should check task status when all_installed is false', async () => {
      mockInstallPackageFromLocal.mockResolvedValue({
        all_installed: false,
        task_id: 'task-123',
      })
      mockCheck.mockResolvedValue({ status: TaskStatus.success, error: null })

      const onInstalled = vi.fn()
      render(<Install {...defaultProps} onInstalled={onInstalled} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(mockCheck).toHaveBeenCalledWith({
          taskId: 'task-123',
          pluginUniqueIdentifier: 'test-unique-identifier',
        })
      })

      await waitFor(() => {
        expect(onInstalled).toHaveBeenCalledWith(true)
      })
    })

    it('should call onFailed when task status is failed', async () => {
      mockInstallPackageFromLocal.mockResolvedValue({
        all_installed: false,
        task_id: 'task-123',
      })
      mockCheck.mockResolvedValue({ status: TaskStatus.failed, error: 'Task failed error' })

      const onFailed = vi.fn()
      render(<Install {...defaultProps} onFailed={onFailed} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('Task failed error')
      })
    })

    it('should uninstall existing plugin before installing new version', async () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-author/Test Plugin': {
            installedVersion: '0.9.0',
            installedId: 'installed-id-to-uninstall',
            uniqueIdentifier: 'old-uid',
          },
        },
        isLoading: false,
      })
      mockUninstallPlugin.mockResolvedValue({})
      mockInstallPackageFromLocal.mockResolvedValue({
        all_installed: true,
        task_id: 'task-123',
      })

      render(<Install {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('installed-id-to-uninstall')
      })

      await waitFor(() => {
        expect(mockInstallPackageFromLocal).toHaveBeenCalled()
      })
    })
  })

  // ================================
  // Error Handling Tests
  // ================================
  describe('Error Handling', () => {
    it('should call onFailed with error string', async () => {
      mockInstallPackageFromLocal.mockRejectedValue('Installation error string')

      const onFailed = vi.fn()
      render(<Install {...defaultProps} onFailed={onFailed} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('Installation error string')
      })
    })

    it('should call onFailed without message when error is not string', async () => {
      mockInstallPackageFromLocal.mockRejectedValue({ code: 'ERROR' })

      const onFailed = vi.fn()
      render(<Install {...defaultProps} onFailed={onFailed} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith()
      })
    })
  })

  // ================================
  // Auto Install Behavior Tests
  // ================================
  describe('Auto Install Behavior', () => {
    it('should call onInstalled when already installed with same uniqueIdentifier', async () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-author/Test Plugin': {
            installedVersion: '1.0.0',
            installedId: 'installed-id',
            uniqueIdentifier: 'test-unique-identifier',
          },
        },
        isLoading: false,
      })

      const onInstalled = vi.fn()
      render(<Install {...defaultProps} onInstalled={onInstalled} />)

      await waitFor(() => {
        expect(onInstalled).toHaveBeenCalled()
      })
    })

    it('should not auto-call onInstalled when uniqueIdentifier differs', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-author/Test Plugin': {
            installedVersion: '1.0.0',
            installedId: 'installed-id',
            uniqueIdentifier: 'different-uid',
          },
        },
        isLoading: false,
      })

      const onInstalled = vi.fn()
      render(<Install {...defaultProps} onInstalled={onInstalled} />)

      // Should not be called immediately
      expect(onInstalled).not.toHaveBeenCalled()
    })
  })

  // ================================
  // Dify Version Compatibility Tests
  // ================================
  describe('Dify Version Compatibility', () => {
    it('should not show warning when dify version is compatible', () => {
      mockLangGeniusVersionInfo.current_version = '1.0.0'
      const payload = createMockManifest({ meta: { version: '1.0.0', minimum_dify_version: '0.8.0' } })

      render(<Install {...defaultProps} payload={payload} />)

      expect(screen.queryByText(/plugin.difyVersionNotCompatible/)).not.toBeInTheDocument()
    })

    it('should show warning when dify version is incompatible', () => {
      mockLangGeniusVersionInfo.current_version = '1.0.0'
      const payload = createMockManifest({ meta: { version: '1.0.0', minimum_dify_version: '2.0.0' } })

      render(<Install {...defaultProps} payload={payload} />)

      expect(screen.getByText(/plugin.difyVersionNotCompatible/)).toBeInTheDocument()
    })

    it('should be compatible when minimum_dify_version is undefined', () => {
      mockLangGeniusVersionInfo.current_version = '1.0.0'
      const payload = createMockManifest({ meta: { version: '1.0.0' } })

      render(<Install {...defaultProps} payload={payload} />)

      expect(screen.queryByText(/plugin.difyVersionNotCompatible/)).not.toBeInTheDocument()
    })

    it('should be compatible when current_version is empty', () => {
      mockLangGeniusVersionInfo.current_version = ''
      const payload = createMockManifest({ meta: { version: '1.0.0', minimum_dify_version: '2.0.0' } })

      render(<Install {...defaultProps} payload={payload} />)

      // When current_version is empty, should be compatible (no warning)
      expect(screen.queryByText(/plugin.difyVersionNotCompatible/)).not.toBeInTheDocument()
    })

    it('should be compatible when current_version is undefined', () => {
      mockLangGeniusVersionInfo.current_version = undefined as unknown as string
      const payload = createMockManifest({ meta: { version: '1.0.0', minimum_dify_version: '2.0.0' } })

      render(<Install {...defaultProps} payload={payload} />)

      // When current_version is undefined, should be compatible (no warning)
      expect(screen.queryByText(/plugin.difyVersionNotCompatible/)).not.toBeInTheDocument()
    })
  })

  // ================================
  // Installing State Tests
  // ================================
  describe('Installing State', () => {
    it('should show installing text when installing', async () => {
      mockInstallPackageFromLocal.mockImplementation(() => new Promise(() => {}))

      render(<Install {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installing')).toBeInTheDocument()
      })
    })

    it('should disable install button when installing', async () => {
      mockInstallPackageFromLocal.mockImplementation(() => new Promise(() => {}))

      render(<Install {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /plugin.installModal.installing/ })).toBeDisabled()
      })
    })

    it('should show loading spinner when installing', async () => {
      mockInstallPackageFromLocal.mockImplementation(() => new Promise(() => {}))

      render(<Install {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin-slow')
        expect(spinner).toBeInTheDocument()
      })
    })

    it('should not trigger install twice when already installing', async () => {
      mockInstallPackageFromLocal.mockImplementation(() => new Promise(() => {}))

      render(<Install {...defaultProps} />)

      const installButton = screen.getByRole('button', { name: 'plugin.installModal.install' })

      // Click install
      fireEvent.click(installButton)

      await waitFor(() => {
        expect(mockInstallPackageFromLocal).toHaveBeenCalledTimes(1)
      })

      // Try to click again (button should be disabled but let's verify the guard works)
      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.installing/ }))

      // Should still only be called once due to isInstalling guard
      expect(mockInstallPackageFromLocal).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Callback Props Tests
  // ================================
  describe('Callback Props', () => {
    it('should work without onStartToInstall callback', async () => {
      mockInstallPackageFromLocal.mockResolvedValue({
        all_installed: true,
        task_id: 'task-123',
      })

      const onInstalled = vi.fn()
      render(
        <Install
          {...defaultProps}
          onStartToInstall={undefined}
          onInstalled={onInstalled}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

      await waitFor(() => {
        expect(onInstalled).toHaveBeenCalled()
      })
    })
  })
})
