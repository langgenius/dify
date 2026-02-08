import type { Plugin, PluginDeclaration, UpdateFromGitHubPayload } from '../../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, TaskStatus } from '../../../types'
import Loaded from './loaded'

// Mock dependencies
const mockUseCheckInstalled = vi.fn()
vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: (params: { pluginIds: string[], enabled: boolean }) => mockUseCheckInstalled(params),
}))

const mockUpdateFromGitHub = vi.fn()
vi.mock('@/service/plugins', () => ({
  updateFromGitHub: (...args: unknown[]) => mockUpdateFromGitHub(...args),
}))

const mockInstallPackageFromGitHub = vi.fn()
const mockHandleRefetch = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromGitHub: () => ({ mutateAsync: mockInstallPackageFromGitHub }),
  usePluginTaskList: () => ({ handleRefetch: mockHandleRefetch }),
}))

const mockCheck = vi.fn()
vi.mock('../../base/check-task-status', () => ({
  default: () => ({ check: mockCheck }),
}))

// Mock Card component
vi.mock('../../../card', () => ({
  default: ({ payload, titleLeft }: { payload: Plugin, titleLeft?: React.ReactNode }) => (
    <div data-testid="plugin-card">
      <span data-testid="card-name">{payload.name}</span>
      {!!titleLeft && <span data-testid="title-left">{titleLeft}</span>}
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
    <span data-testid="version-info">
      {hasInstalled ? `Update from ${installedVersion} to ${toInstallVersion}` : `Install ${toInstallVersion}`}
    </span>
  ),
}))

// Factory functions
const createMockPayload = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'test-uid',
  version: '1.0.0',
  author: 'test-author',
  icon: 'icon.png',
  name: 'Test Plugin',
  category: PluginCategoryEnum.tool,
  label: { 'en-US': 'Test' } as PluginDeclaration['label'],
  description: { 'en-US': 'Test Description' } as PluginDeclaration['description'],
  created_at: '2024-01-01',
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
})

const createMockPluginPayload = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'Test Plugin',
  plugin_id: 'test-plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-pkg',
  icon: 'icon.png',
  verified: true,
  label: { 'en-US': 'Test' },
  brief: { 'en-US': 'Brief' },
  description: { 'en-US': 'Description' },
  introduction: 'Intro',
  repository: '',
  category: PluginCategoryEnum.tool,
  install_count: 100,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'langgenius' },
  from: 'github',
  ...overrides,
})

const createUpdatePayload = (): UpdateFromGitHubPayload => ({
  originalPackageInfo: {
    id: 'original-id',
    repo: 'owner/repo',
    version: 'v0.9.0',
    package: 'plugin.zip',
    releases: [],
  },
})

describe('Loaded', () => {
  const defaultProps = {
    updatePayload: undefined,
    uniqueIdentifier: 'test-unique-id',
    payload: createMockPayload() as PluginDeclaration | Plugin,
    repoUrl: 'https://github.com/owner/repo',
    selectedVersion: 'v1.0.0',
    selectedPackage: 'plugin.zip',
    onBack: vi.fn(),
    onStartToInstall: vi.fn(),
    onInstalled: vi.fn(),
    onFailed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCheckInstalled.mockReturnValue({
      installedInfo: {},
      isLoading: false,
    })
    mockUpdateFromGitHub.mockResolvedValue({ all_installed: true, task_id: 'task-1' })
    mockInstallPackageFromGitHub.mockResolvedValue({ all_installed: true, task_id: 'task-1' })
    mockCheck.mockResolvedValue({ status: TaskStatus.success, error: null })
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render ready to install message', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.readyToInstall')).toBeInTheDocument()
    })

    it('should render plugin card', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByTestId('plugin-card')).toBeInTheDocument()
    })

    it('should render back button when not installing', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).toBeInTheDocument()
    })

    it('should render install button', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByRole('button', { name: /plugin.installModal.install/i })).toBeInTheDocument()
    })

    it('should show version info in card title', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByTestId('version-info')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should display plugin name from payload', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByTestId('card-name')).toHaveTextContent('Test Plugin')
    })

    it('should pass correct version to Version component', () => {
      render(<Loaded {...defaultProps} payload={createMockPayload({ version: '2.0.0' })} />)

      expect(screen.getByTestId('version-info')).toHaveTextContent('Install 2.0.0')
    })
  })

  // ================================
  // Button State Tests
  // ================================
  describe('Button State', () => {
    it('should disable install button while loading', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {},
        isLoading: true,
      })

      render(<Loaded {...defaultProps} />)

      expect(screen.getByRole('button', { name: /plugin.installModal.install/i })).toBeDisabled()
    })

    it('should enable install button when not loading', () => {
      render(<Loaded {...defaultProps} />)

      expect(screen.getByRole('button', { name: /plugin.installModal.install/i })).not.toBeDisabled()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn()
      render(<Loaded {...defaultProps} onBack={onBack} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.back' }))

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onStartToInstall when install starts', async () => {
      const onStartToInstall = vi.fn()
      render(<Loaded {...defaultProps} onStartToInstall={onStartToInstall} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(onStartToInstall).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ================================
  // Installation Flow Tests
  // ================================
  describe('Installation Flows', () => {
    it('should call installPackageFromGitHub for fresh install', async () => {
      const onInstalled = vi.fn()
      render(<Loaded {...defaultProps} onInstalled={onInstalled} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(mockInstallPackageFromGitHub).toHaveBeenCalledWith({
          repoUrl: 'owner/repo',
          selectedVersion: 'v1.0.0',
          selectedPackage: 'plugin.zip',
          uniqueIdentifier: 'test-unique-id',
        })
      })
    })

    it('should call updateFromGitHub when updatePayload is provided', async () => {
      const updatePayload = createUpdatePayload()
      render(<Loaded {...defaultProps} updatePayload={updatePayload} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(mockUpdateFromGitHub).toHaveBeenCalledWith(
          'owner/repo',
          'v1.0.0',
          'plugin.zip',
          'original-id',
          'test-unique-id',
        )
      })
    })

    it('should call updateFromGitHub when plugin is already installed', async () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-plugin-id': {
            installedVersion: '0.9.0',
            uniqueIdentifier: 'installed-uid',
          },
        },
        isLoading: false,
      })

      render(<Loaded {...defaultProps} payload={createMockPluginPayload()} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(mockUpdateFromGitHub).toHaveBeenCalledWith(
          'owner/repo',
          'v1.0.0',
          'plugin.zip',
          'installed-uid',
          'test-unique-id',
        )
      })
    })

    it('should call onInstalled when installation completes immediately', async () => {
      mockInstallPackageFromGitHub.mockResolvedValue({ all_installed: true, task_id: 'task-1' })

      const onInstalled = vi.fn()
      render(<Loaded {...defaultProps} onInstalled={onInstalled} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(onInstalled).toHaveBeenCalled()
      })
    })

    it('should check task status when not immediately installed', async () => {
      mockInstallPackageFromGitHub.mockResolvedValue({ all_installed: false, task_id: 'task-1' })

      render(<Loaded {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(mockHandleRefetch).toHaveBeenCalled()
        expect(mockCheck).toHaveBeenCalledWith({
          taskId: 'task-1',
          pluginUniqueIdentifier: 'test-unique-id',
        })
      })
    })

    it('should call onInstalled with true when task succeeds', async () => {
      mockInstallPackageFromGitHub.mockResolvedValue({ all_installed: false, task_id: 'task-1' })
      mockCheck.mockResolvedValue({ status: TaskStatus.success, error: null })

      const onInstalled = vi.fn()
      render(<Loaded {...defaultProps} onInstalled={onInstalled} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(onInstalled).toHaveBeenCalledWith(true)
      })
    })
  })

  // ================================
  // Error Handling Tests
  // ================================
  describe('Error Handling', () => {
    it('should call onFailed when task fails', async () => {
      mockInstallPackageFromGitHub.mockResolvedValue({ all_installed: false, task_id: 'task-1' })
      mockCheck.mockResolvedValue({ status: TaskStatus.failed, error: 'Installation failed' })

      const onFailed = vi.fn()
      render(<Loaded {...defaultProps} onFailed={onFailed} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('Installation failed')
      })
    })

    it('should call onFailed with string error', async () => {
      mockInstallPackageFromGitHub.mockRejectedValue('String error message')

      const onFailed = vi.fn()
      render(<Loaded {...defaultProps} onFailed={onFailed} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('String error message')
      })
    })

    it('should call onFailed without message for non-string errors', async () => {
      mockInstallPackageFromGitHub.mockRejectedValue(new Error('Error object'))

      const onFailed = vi.fn()
      render(<Loaded {...defaultProps} onFailed={onFailed} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith()
      })
    })
  })

  // ================================
  // Auto-install Effect Tests
  // ================================
  describe('Auto-install Effect', () => {
    it('should call onInstalled when already installed with same identifier', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-plugin-id': {
            installedVersion: '1.0.0',
            uniqueIdentifier: 'test-unique-id',
          },
        },
        isLoading: false,
      })

      const onInstalled = vi.fn()
      render(<Loaded {...defaultProps} payload={createMockPluginPayload()} onInstalled={onInstalled} />)

      expect(onInstalled).toHaveBeenCalled()
    })

    it('should not call onInstalled when identifiers differ', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {
          'test-plugin-id': {
            installedVersion: '1.0.0',
            uniqueIdentifier: 'different-uid',
          },
        },
        isLoading: false,
      })

      const onInstalled = vi.fn()
      render(<Loaded {...defaultProps} payload={createMockPluginPayload()} onInstalled={onInstalled} />)

      expect(onInstalled).not.toHaveBeenCalled()
    })
  })

  // ================================
  // Installing State Tests
  // ================================
  describe('Installing State', () => {
    it('should hide back button while installing', async () => {
      let resolveInstall: (value: { all_installed: boolean, task_id: string }) => void
      mockInstallPackageFromGitHub.mockImplementation(() => new Promise((resolve) => {
        resolveInstall = resolve
      }))

      render(<Loaded {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'plugin.installModal.back' })).not.toBeInTheDocument()
      })

      resolveInstall!({ all_installed: true, task_id: 'task-1' })
    })

    it('should show installing text while installing', async () => {
      let resolveInstall: (value: { all_installed: boolean, task_id: string }) => void
      mockInstallPackageFromGitHub.mockImplementation(() => new Promise((resolve) => {
        resolveInstall = resolve
      }))

      render(<Loaded {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installing')).toBeInTheDocument()
      })

      resolveInstall!({ all_installed: true, task_id: 'task-1' })
    })

    it('should not trigger install twice when already installing', async () => {
      let resolveInstall: (value: { all_installed: boolean, task_id: string }) => void
      mockInstallPackageFromGitHub.mockImplementation(() => new Promise((resolve) => {
        resolveInstall = resolve
      }))

      render(<Loaded {...defaultProps} />)

      const installButton = screen.getByRole('button', { name: /plugin.installModal.install/i })

      // Click twice
      fireEvent.click(installButton)
      fireEvent.click(installButton)

      await waitFor(() => {
        expect(mockInstallPackageFromGitHub).toHaveBeenCalledTimes(1)
      })

      resolveInstall!({ all_installed: true, task_id: 'task-1' })
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle missing onStartToInstall callback', async () => {
      render(<Loaded {...defaultProps} onStartToInstall={undefined} />)

      // Should not throw when callback is undefined
      expect(() => {
        fireEvent.click(screen.getByRole('button', { name: /plugin.installModal.install/i }))
      }).not.toThrow()

      await waitFor(() => {
        expect(mockInstallPackageFromGitHub).toHaveBeenCalled()
      })
    })

    it('should handle plugin without plugin_id', () => {
      mockUseCheckInstalled.mockReturnValue({
        installedInfo: {},
        isLoading: false,
      })

      render(<Loaded {...defaultProps} payload={createMockPayload()} />)

      expect(mockUseCheckInstalled).toHaveBeenCalledWith({
        pluginIds: [undefined],
        enabled: false,
      })
    })

    it('should preserve state after component update', () => {
      const { rerender } = render(<Loaded {...defaultProps} />)

      rerender(<Loaded {...defaultProps} />)

      expect(screen.getByTestId('plugin-card')).toBeInTheDocument()
    })
  })
})
