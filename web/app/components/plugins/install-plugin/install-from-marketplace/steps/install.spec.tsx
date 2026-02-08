import type { Plugin, PluginManifestInMarket } from '../../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, TaskStatus } from '../../../types'
import Install from './install'

// Factory functions for test data
const createMockManifest = (overrides: Partial<PluginManifestInMarket> = {}): PluginManifestInMarket => ({
  plugin_unique_identifier: 'test-unique-identifier',
  name: 'Test Plugin',
  org: 'test-org',
  icon: 'test-icon.png',
  label: { en_US: 'Test Plugin' } as PluginManifestInMarket['label'],
  category: PluginCategoryEnum.tool,
  version: '1.0.0',
  latest_version: '1.0.0',
  brief: { en_US: 'A test plugin' } as PluginManifestInMarket['brief'],
  introduction: 'Introduction text',
  verified: true,
  install_count: 100,
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createMockPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'Test Plugin',
  plugin_id: 'test-plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-package-id',
  icon: 'test-icon.png',
  verified: true,
  label: { en_US: 'Test Plugin' },
  brief: { en_US: 'A test plugin' },
  description: { en_US: 'A test plugin description' },
  introduction: 'Introduction text',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 100,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

// Mock variables for controlling test behavior
let mockInstalledInfo: Record<string, { installedId: string, installedVersion: string, uniqueIdentifier: string }> | undefined
let mockIsLoading = false
const mockInstallPackageFromMarketPlace = vi.fn()
const mockUpdatePackageFromMarketPlace = vi.fn()
const mockCheckTaskStatus = vi.fn()
const mockStopTaskStatus = vi.fn()
const mockHandleRefetch = vi.fn()
let mockPluginDeclaration: { manifest: { meta: { minimum_dify_version: string } } } | undefined
let mockCanInstall = true
let mockLangGeniusVersionInfo = { current_version: '1.0.0' }

// Mock useCheckInstalled
vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: ({ pluginIds }: { pluginIds: string[], enabled: boolean }) => ({
    installedInfo: mockInstalledInfo,
    isLoading: mockIsLoading,
    error: null,
  }),
}))

// Mock service hooks
vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromMarketPlace: () => ({
    mutateAsync: mockInstallPackageFromMarketPlace,
  }),
  useUpdatePackageFromMarketPlace: () => ({
    mutateAsync: mockUpdatePackageFromMarketPlace,
  }),
  usePluginDeclarationFromMarketPlace: () => ({
    data: mockPluginDeclaration,
  }),
  usePluginTaskList: () => ({
    handleRefetch: mockHandleRefetch,
  }),
}))

// Mock checkTaskStatus
vi.mock('../../base/check-task-status', () => ({
  default: () => ({
    check: mockCheckTaskStatus,
    stop: mockStopTaskStatus,
  }),
}))

// Mock useAppContext
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    langGeniusVersionInfo: mockLangGeniusVersionInfo,
  }),
}))

// Mock useInstallPluginLimit
vi.mock('../../hooks/use-install-plugin-limit', () => ({
  default: () => ({ canInstall: mockCanInstall }),
}))

// Mock Card component
vi.mock('../../../card', () => ({
  default: ({ payload, titleLeft, className, limitedInstall }: {
    payload: any
    titleLeft?: React.ReactNode
    className?: string
    limitedInstall?: boolean
  }) => (
    <div data-testid="plugin-card">
      <span data-testid="card-payload-name">{payload?.name}</span>
      <span data-testid="card-limited-install">{limitedInstall ? 'true' : 'false'}</span>
      {!!titleLeft && <div data-testid="card-title-left">{titleLeft}</div>}
    </div>
  ),
}))

// Mock Version component
vi.mock('../../base/version', () => ({
  default: ({ hasInstalled, installedVersion, toInstallVersion }: {
    hasInstalled: boolean
    installedVersion?: string
    toInstallVersion: string
  }) => (
    <div data-testid="version-component">
      <span data-testid="has-installed">{hasInstalled ? 'true' : 'false'}</span>
      <span data-testid="installed-version">{installedVersion || 'none'}</span>
      <span data-testid="to-install-version">{toInstallVersion}</span>
    </div>
  ),
}))

// Mock utils
vi.mock('../../utils', () => ({
  pluginManifestInMarketToPluginProps: (payload: PluginManifestInMarket) => ({
    name: payload.name,
    icon: payload.icon,
    category: payload.category,
  }),
}))

describe('Install Component (steps/install.tsx)', () => {
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
    mockInstalledInfo = undefined
    mockIsLoading = false
    mockPluginDeclaration = undefined
    mockCanInstall = true
    mockLangGeniusVersionInfo = { current_version: '1.0.0' }
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: false,
      task_id: 'task-123',
    })
    mockUpdatePackageFromMarketPlace.mockResolvedValue({
      all_installed: false,
      task_id: 'task-456',
    })
    mockCheckTaskStatus.mockResolvedValue({
      status: TaskStatus.success,
    })
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render ready to install text', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.readyToInstall')).toBeInTheDocument()
    })

    it('should render plugin card with correct payload', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('plugin-card')).toBeInTheDocument()
      expect(screen.getByTestId('card-payload-name')).toHaveTextContent('Test Plugin')
    })

    it('should render cancel button when not installing', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    })

    it('should render install button', () => {
      render(<Install {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.install')).toBeInTheDocument()
    })

    it('should not render version component while loading', () => {
      mockIsLoading = true
      render(<Install {...defaultProps} />)

      expect(screen.queryByTestId('version-component')).not.toBeInTheDocument()
    })

    it('should render version component when not loading', () => {
      mockIsLoading = false
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('version-component')).toBeInTheDocument()
    })
  })

  // ================================
  // Version Display Tests
  // ================================
  describe('Version Display', () => {
    it('should show hasInstalled as false when not installed', () => {
      mockInstalledInfo = undefined
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('has-installed')).toHaveTextContent('false')
    })

    it('should show hasInstalled as true when already installed', () => {
      mockInstalledInfo = {
        'test-plugin-id': {
          installedId: 'install-id',
          installedVersion: '0.9.0',
          uniqueIdentifier: 'old-unique-id',
        },
      }
      const plugin = createMockPlugin()
      render(<Install {...defaultProps} payload={plugin} />)

      expect(screen.getByTestId('has-installed')).toHaveTextContent('true')
      expect(screen.getByTestId('installed-version')).toHaveTextContent('0.9.0')
    })

    it('should show correct toInstallVersion from payload.version', () => {
      const manifest = createMockManifest({ version: '2.0.0' })
      render(<Install {...defaultProps} payload={manifest} />)

      expect(screen.getByTestId('to-install-version')).toHaveTextContent('2.0.0')
    })

    it('should fallback to latest_version when version is undefined', () => {
      const manifest = createMockManifest({ version: undefined as any, latest_version: '3.0.0' })
      render(<Install {...defaultProps} payload={manifest} />)

      expect(screen.getByTestId('to-install-version')).toHaveTextContent('3.0.0')
    })
  })

  // ================================
  // Version Compatibility Tests
  // ================================
  describe('Version Compatibility', () => {
    it('should not show warning when no plugin declaration', () => {
      mockPluginDeclaration = undefined
      render(<Install {...defaultProps} />)

      expect(screen.queryByText(/difyVersionNotCompatible/)).not.toBeInTheDocument()
    })

    it('should not show warning when dify version is compatible', () => {
      mockLangGeniusVersionInfo = { current_version: '2.0.0' }
      mockPluginDeclaration = {
        manifest: { meta: { minimum_dify_version: '1.0.0' } },
      }
      render(<Install {...defaultProps} />)

      expect(screen.queryByText(/difyVersionNotCompatible/)).not.toBeInTheDocument()
    })

    it('should show warning when dify version is incompatible', () => {
      mockLangGeniusVersionInfo = { current_version: '1.0.0' }
      mockPluginDeclaration = {
        manifest: { meta: { minimum_dify_version: '2.0.0' } },
      }
      render(<Install {...defaultProps} />)

      expect(screen.getByText(/plugin.difyVersionNotCompatible/)).toBeInTheDocument()
    })
  })

  // ================================
  // Install Limit Tests
  // ================================
  describe('Install Limit', () => {
    it('should pass limitedInstall=false to Card when canInstall is true', () => {
      mockCanInstall = true
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('card-limited-install')).toHaveTextContent('false')
    })

    it('should pass limitedInstall=true to Card when canInstall is false', () => {
      mockCanInstall = false
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('card-limited-install')).toHaveTextContent('true')
    })

    it('should disable install button when canInstall is false', () => {
      mockCanInstall = false
      render(<Install {...defaultProps} />)

      const installBtn = screen.getByText('plugin.installModal.install').closest('button')
      expect(installBtn).toBeDisabled()
    })
  })

  // ================================
  // Button States Tests
  // ================================
  describe('Button States', () => {
    it('should disable install button when loading', () => {
      mockIsLoading = true
      render(<Install {...defaultProps} />)

      const installBtn = screen.getByText('plugin.installModal.install').closest('button')
      expect(installBtn).toBeDisabled()
    })

    it('should enable install button when not loading and canInstall', () => {
      mockIsLoading = false
      mockCanInstall = true
      render(<Install {...defaultProps} />)

      const installBtn = screen.getByText('plugin.installModal.install').closest('button')
      expect(installBtn).not.toBeDisabled()
    })
  })

  // ================================
  // Cancel Button Tests
  // ================================
  describe('Cancel Button', () => {
    it('should call onCancel and stop when cancel is clicked', () => {
      render(<Install {...defaultProps} />)

      fireEvent.click(screen.getByText('common.operation.cancel'))

      expect(mockStopTaskStatus).toHaveBeenCalled()
      expect(defaultProps.onCancel).toHaveBeenCalled()
    })
  })

  // ================================
  // New Installation Flow Tests
  // ================================
  describe('New Installation Flow', () => {
    it('should call onStartToInstall when install button is clicked', async () => {
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      expect(defaultProps.onStartToInstall).toHaveBeenCalled()
    })

    it('should call installPackageFromMarketPlace for new installation', async () => {
      mockInstalledInfo = undefined
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(mockInstallPackageFromMarketPlace).toHaveBeenCalledWith('test-unique-identifier')
      })
    })

    it('should call onInstalled immediately when all_installed is true', async () => {
      mockInstallPackageFromMarketPlace.mockResolvedValue({
        all_installed: true,
        task_id: 'task-123',
      })
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(defaultProps.onInstalled).toHaveBeenCalled()
        expect(mockCheckTaskStatus).not.toHaveBeenCalled()
      })
    })

    it('should check task status when all_installed is false', async () => {
      mockInstallPackageFromMarketPlace.mockResolvedValue({
        all_installed: false,
        task_id: 'task-123',
      })
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(mockHandleRefetch).toHaveBeenCalled()
        expect(mockCheckTaskStatus).toHaveBeenCalledWith({
          taskId: 'task-123',
          pluginUniqueIdentifier: 'test-unique-identifier',
        })
      })
    })

    it('should call onInstalled with true when task succeeds', async () => {
      mockCheckTaskStatus.mockResolvedValue({ status: TaskStatus.success })
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(defaultProps.onInstalled).toHaveBeenCalledWith(true)
      })
    })

    it('should call onFailed when task fails', async () => {
      mockCheckTaskStatus.mockResolvedValue({
        status: TaskStatus.failed,
        error: 'Task failed error',
      })
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(defaultProps.onFailed).toHaveBeenCalledWith('Task failed error')
      })
    })
  })

  // ================================
  // Update Installation Flow Tests
  // ================================
  describe('Update Installation Flow', () => {
    beforeEach(() => {
      mockInstalledInfo = {
        'test-plugin-id': {
          installedId: 'install-id',
          installedVersion: '0.9.0',
          uniqueIdentifier: 'old-unique-id',
        },
      }
    })

    it('should call updatePackageFromMarketPlace for update installation', async () => {
      const plugin = createMockPlugin()
      render(<Install {...defaultProps} payload={plugin} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(mockUpdatePackageFromMarketPlace).toHaveBeenCalledWith({
          original_plugin_unique_identifier: 'old-unique-id',
          new_plugin_unique_identifier: 'test-unique-identifier',
        })
      })
    })

    it('should not call installPackageFromMarketPlace when updating', async () => {
      const plugin = createMockPlugin()
      render(<Install {...defaultProps} payload={plugin} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(mockInstallPackageFromMarketPlace).not.toHaveBeenCalled()
      })
    })
  })

  // ================================
  // Auto-Install on Already Installed Tests
  // ================================
  describe('Auto-Install on Already Installed', () => {
    it('should call onInstalled when already installed with same uniqueIdentifier', async () => {
      mockInstalledInfo = {
        'test-plugin-id': {
          installedId: 'install-id',
          installedVersion: '1.0.0',
          uniqueIdentifier: 'test-unique-identifier',
        },
      }
      const plugin = createMockPlugin()
      render(<Install {...defaultProps} payload={plugin} />)

      await waitFor(() => {
        expect(defaultProps.onInstalled).toHaveBeenCalled()
      })
    })

    it('should not auto-install when uniqueIdentifier differs', async () => {
      mockInstalledInfo = {
        'test-plugin-id': {
          installedId: 'install-id',
          installedVersion: '1.0.0',
          uniqueIdentifier: 'different-unique-id',
        },
      }
      const plugin = createMockPlugin()
      render(<Install {...defaultProps} payload={plugin} />)

      // Wait a bit to ensure onInstalled is not called
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(defaultProps.onInstalled).not.toHaveBeenCalled()
    })
  })

  // ================================
  // Error Handling Tests
  // ================================
  describe('Error Handling', () => {
    it('should call onFailed with string error', async () => {
      mockInstallPackageFromMarketPlace.mockRejectedValue('String error message')
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(defaultProps.onFailed).toHaveBeenCalledWith('String error message')
      })
    })

    it('should call onFailed without message for non-string error', async () => {
      mockInstallPackageFromMarketPlace.mockRejectedValue(new Error('Error object'))
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(defaultProps.onFailed).toHaveBeenCalledWith()
      })
    })
  })

  // ================================
  // Installing State Tests
  // ================================
  describe('Installing State', () => {
    it('should hide cancel button while installing', async () => {
      // Make the install take some time
      mockInstallPackageFromMarketPlace.mockImplementation(() => new Promise(() => {}))
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(screen.queryByText('common.operation.cancel')).not.toBeInTheDocument()
      })
    })

    it('should show installing text while installing', async () => {
      mockInstallPackageFromMarketPlace.mockImplementation(() => new Promise(() => {}))
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installing')).toBeInTheDocument()
      })
    })

    it('should disable install button while installing', async () => {
      mockInstallPackageFromMarketPlace.mockImplementation(() => new Promise(() => {}))
      render(<Install {...defaultProps} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        const installBtn = screen.getByText('plugin.installModal.installing').closest('button')
        expect(installBtn).toBeDisabled()
      })
    })

    it('should not trigger multiple installs when clicking rapidly', async () => {
      mockInstallPackageFromMarketPlace.mockImplementation(() => new Promise(() => {}))
      render(<Install {...defaultProps} />)

      const installBtn = screen.getByText('plugin.installModal.install').closest('button')!

      await act(async () => {
        fireEvent.click(installBtn)
      })

      // Wait for the button to be disabled
      await waitFor(() => {
        expect(installBtn).toBeDisabled()
      })

      // Try clicking again - should not trigger another install
      await act(async () => {
        fireEvent.click(installBtn)
        fireEvent.click(installBtn)
      })

      expect(mockInstallPackageFromMarketPlace).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Prop Variations Tests
  // ================================
  describe('Prop Variations', () => {
    it('should work with PluginManifestInMarket payload', () => {
      const manifest = createMockManifest({ name: 'Manifest Plugin' })
      render(<Install {...defaultProps} payload={manifest} />)

      expect(screen.getByTestId('card-payload-name')).toHaveTextContent('Manifest Plugin')
    })

    it('should work with Plugin payload', () => {
      const plugin = createMockPlugin({ name: 'Plugin Type' })
      render(<Install {...defaultProps} payload={plugin} />)

      expect(screen.getByTestId('card-payload-name')).toHaveTextContent('Plugin Type')
    })

    it('should work without onStartToInstall callback', async () => {
      const propsWithoutCallback = {
        ...defaultProps,
        onStartToInstall: undefined,
      }
      render(<Install {...propsWithoutCallback} />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      // Should not throw and should proceed with installation
      await waitFor(() => {
        expect(mockInstallPackageFromMarketPlace).toHaveBeenCalled()
      })
    })

    it('should handle different uniqueIdentifier values', async () => {
      render(<Install {...defaultProps} uniqueIdentifier="custom-id-123" />)

      await act(async () => {
        fireEvent.click(screen.getByText('plugin.installModal.install'))
      })

      await waitFor(() => {
        expect(mockInstallPackageFromMarketPlace).toHaveBeenCalledWith('custom-id-123')
      })
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty plugin_id gracefully', () => {
      const manifest = createMockManifest()
      // Manifest doesn't have plugin_id, so installedInfo won't match
      render(<Install {...defaultProps} payload={manifest} />)

      expect(screen.getByTestId('has-installed')).toHaveTextContent('false')
    })

    it('should handle undefined installedInfo', () => {
      mockInstalledInfo = undefined
      render(<Install {...defaultProps} />)

      expect(screen.getByTestId('has-installed')).toHaveTextContent('false')
    })

    it('should handle null current_version in langGeniusVersionInfo', () => {
      mockLangGeniusVersionInfo = { current_version: null as any }
      mockPluginDeclaration = {
        manifest: { meta: { minimum_dify_version: '1.0.0' } },
      }
      render(<Install {...defaultProps} />)

      // Should not show warning when current_version is null (defaults to compatible)
      expect(screen.queryByText(/difyVersionNotCompatible/)).not.toBeInTheDocument()
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should maintain stable component across rerenders with same props', () => {
      const { rerender } = render(<Install {...defaultProps} />)

      expect(screen.getByTestId('plugin-card')).toBeInTheDocument()

      rerender(<Install {...defaultProps} />)

      expect(screen.getByTestId('plugin-card')).toBeInTheDocument()
    })
  })
})
