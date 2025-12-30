import type { MetaData, PluginCategoryEnum } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'

// ==================== Imports (after mocks) ====================

import { PluginSource } from '../types'
import Action from './action'

// ==================== Mock Setup ====================

// Use vi.hoisted to define mock functions that can be referenced in vi.mock
const {
  mockUninstallPlugin,
  mockFetchReleases,
  mockCheckForUpdates,
  mockSetShowUpdatePluginModal,
  mockInvalidateInstalledPluginList,
} = vi.hoisted(() => ({
  mockUninstallPlugin: vi.fn(),
  mockFetchReleases: vi.fn(),
  mockCheckForUpdates: vi.fn(),
  mockSetShowUpdatePluginModal: vi.fn(),
  mockInvalidateInstalledPluginList: vi.fn(),
}))

// Mock uninstall plugin service
vi.mock('@/service/plugins', () => ({
  uninstallPlugin: (id: string) => mockUninstallPlugin(id),
}))

// Mock GitHub releases hook
vi.mock('../install-plugin/hooks', () => ({
  useGitHubReleases: () => ({
    fetchReleases: mockFetchReleases,
    checkForUpdates: mockCheckForUpdates,
  }),
}))

// Mock modal context
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowUpdatePluginModal: mockSetShowUpdatePluginModal,
  }),
}))

// Mock invalidate installed plugin list
vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

// Mock PluginInfo component - has complex dependencies (Modal, KeyValueItem)
vi.mock('../plugin-page/plugin-info', () => ({
  default: ({ repository, release, packageName, onHide }: {
    repository: string
    release: string
    packageName: string
    onHide: () => void
  }) => (
    <div data-testid="plugin-info-modal" data-repo={repository} data-release={release} data-package={packageName}>
      <button data-testid="close-plugin-info" onClick={onHide}>Close</button>
    </div>
  ),
}))

// Mock Tooltip - uses PortalToFollowElem which requires complex floating UI setup
// Simplified mock that just renders children with tooltip content accessible
vi.mock('../../base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-popup-content={popupContent}>
      {children}
    </div>
  ),
}))

// Mock Confirm - uses createPortal which has issues in test environment
vi.mock('../../base/confirm', () => ({
  default: ({ isShow, title, content, onCancel, onConfirm, isLoading, isDisabled }: {
    isShow: boolean
    title: string
    content: React.ReactNode
    onCancel: () => void
    onConfirm: () => void
    isLoading: boolean
    isDisabled: boolean
  }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-modal" data-loading={isLoading} data-disabled={isDisabled}>
        <div data-testid="confirm-title">{title}</div>
        <div data-testid="confirm-content">{content}</div>
        <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
        <button data-testid="confirm-ok" onClick={onConfirm} disabled={isDisabled}>Confirm</button>
      </div>
    )
  },
}))

// ==================== Test Utilities ====================

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

// ==================== Tests ====================

// Helper to find action buttons (real ActionButton component uses type="button")
const getActionButtons = () => screen.getAllByRole('button')
const queryActionButtons = () => screen.queryAllByRole('button')

describe('Action Component', () => {
  // Spy on Toast.notify - real component but we track calls
  let toastNotifySpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Spy on Toast.notify and mock implementation to avoid DOM side effects
    toastNotifySpy = vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
    mockUninstallPlugin.mockResolvedValue({ success: true })
    mockFetchReleases.mockResolvedValue([])
    mockCheckForUpdates.mockReturnValue({
      needUpdate: false,
      toastProps: { type: 'info', message: 'Up to date' },
    })
  })

  afterEach(() => {
    toastNotifySpy.mockRestore()
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render delete button when isShowDelete is true', () => {
      // Arrange
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)

      // Assert
      expect(getActionButtons()).toHaveLength(1)
    })

    it('should render fetch new version button when isShowFetchNewVersion is true', () => {
      // Arrange
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowInfo: false,
        isShowDelete: false,
      })

      // Act
      render(<Action {...props} />)

      // Assert
      expect(getActionButtons()).toHaveLength(1)
    })

    it('should render info button when isShowInfo is true', () => {
      // Arrange
      const props = createActionProps({
        isShowFetchNewVersion: false,
        isShowInfo: true,
        isShowDelete: false,
      })

      // Act
      render(<Action {...props} />)

      // Assert
      expect(getActionButtons()).toHaveLength(1)
    })

    it('should render all buttons when all flags are true', () => {
      // Arrange
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowInfo: true,
        isShowDelete: true,
      })

      // Act
      render(<Action {...props} />)

      // Assert
      expect(getActionButtons()).toHaveLength(3)
    })

    it('should render no buttons when all flags are false', () => {
      // Arrange
      const props = createActionProps({
        isShowFetchNewVersion: false,
        isShowInfo: false,
        isShowDelete: false,
      })

      // Act
      render(<Action {...props} />)

      // Assert
      expect(queryActionButtons()).toHaveLength(0)
    })

    it('should render tooltips for each button', () => {
      // Arrange
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowInfo: true,
        isShowDelete: true,
      })

      // Act
      render(<Action {...props} />)

      // Assert
      const tooltips = screen.getAllByTestId('tooltip')
      expect(tooltips).toHaveLength(3)
    })
  })

  // ==================== Delete Functionality Tests ====================
  describe('Delete Functionality', () => {
    it('should show delete confirm modal when delete button is clicked', () => {
      // Arrange
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-title')).toHaveTextContent('plugin.action.delete')
    })

    it('should display plugin name in delete confirm content', () => {
      // Arrange
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        pluginName: 'my-awesome-plugin',
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      expect(screen.getByText('my-awesome-plugin')).toBeInTheDocument()
    })

    it('should hide confirm modal when cancel is clicked', () => {
      // Arrange
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('confirm-cancel'))

      // Assert
      expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
    })

    it('should call uninstallPlugin when confirm is clicked', async () => {
      // Arrange
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        installationId: 'install-456',
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert
      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('install-456')
      })
    })

    it('should call onDelete callback after successful uninstall', async () => {
      // Arrange
      mockUninstallPlugin.mockResolvedValue({ success: true })
      const onDelete = vi.fn()
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        onDelete,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert
      await waitFor(() => {
        expect(onDelete).toHaveBeenCalled()
      })
    })

    it('should not call onDelete if uninstall fails', async () => {
      // Arrange
      mockUninstallPlugin.mockResolvedValue({ success: false })
      const onDelete = vi.fn()
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        onDelete,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert
      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalled()
      })
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('should handle uninstall error gracefully', async () => {
      // Arrange
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockUninstallPlugin.mockRejectedValue(new Error('Network error'))
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('uninstallPlugin error', expect.any(Error))
      })

      consoleError.mockRestore()
    })

    it('should show loading state during deletion', async () => {
      // Arrange
      let resolveUninstall: (value: { success: boolean }) => void
      mockUninstallPlugin.mockReturnValue(
        new Promise((resolve) => {
          resolveUninstall = resolve
        }),
      )
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert - Loading state
      await waitFor(() => {
        expect(screen.getByTestId('confirm-modal')).toHaveAttribute('data-loading', 'true')
      })

      // Resolve and check modal closes
      resolveUninstall!({ success: true })
      await waitFor(() => {
        expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
      })
    })
  })

  // ==================== Plugin Info Tests ====================
  describe('Plugin Info', () => {
    it('should show plugin info modal when info button is clicked', () => {
      // Arrange
      const props = createActionProps({
        isShowInfo: true,
        isShowDelete: false,
        isShowFetchNewVersion: false,
        meta: {
          repo: 'owner/repo-name',
          version: '2.0.0',
          package: 'my-package.difypkg',
        },
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      expect(screen.getByTestId('plugin-info-modal')).toBeInTheDocument()
      expect(screen.getByTestId('plugin-info-modal')).toHaveAttribute('data-repo', 'owner/repo-name')
      expect(screen.getByTestId('plugin-info-modal')).toHaveAttribute('data-release', '2.0.0')
      expect(screen.getByTestId('plugin-info-modal')).toHaveAttribute('data-package', 'my-package.difypkg')
    })

    it('should hide plugin info modal when close is clicked', () => {
      // Arrange
      const props = createActionProps({
        isShowInfo: true,
        isShowDelete: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      expect(screen.getByTestId('plugin-info-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-plugin-info'))

      // Assert
      expect(screen.queryByTestId('plugin-info-modal')).not.toBeInTheDocument()
    })
  })

  // ==================== Check for Updates Tests ====================
  describe('Check for Updates', () => {
    it('should fetch releases when check for updates button is clicked', async () => {
      // Arrange
      mockFetchReleases.mockResolvedValue([{ version: '1.0.0' }])
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
        meta: {
          repo: 'owner/repo',
          version: '1.0.0',
          package: 'pkg.difypkg',
        },
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalledWith('owner', 'repo')
      })
    })

    it('should use author and pluginName as fallback for empty repo parts', async () => {
      // Arrange
      mockFetchReleases.mockResolvedValue([{ version: '1.0.0' }])
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
        author: 'fallback-author',
        pluginName: 'fallback-plugin',
        meta: {
          repo: '/', // Results in empty parts after split
          version: '1.0.0',
          package: 'pkg.difypkg',
        },
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalledWith('fallback-author', 'fallback-plugin')
      })
    })

    it('should not proceed if no releases are fetched', async () => {
      // Arrange
      mockFetchReleases.mockResolvedValue([])
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalled()
      })
      expect(mockCheckForUpdates).not.toHaveBeenCalled()
    })

    it('should show toast notification after checking for updates', async () => {
      // Arrange
      mockFetchReleases.mockResolvedValue([{ version: '2.0.0' }])
      mockCheckForUpdates.mockReturnValue({
        needUpdate: false,
        toastProps: { type: 'success', message: 'Already up to date' },
      })
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert - Toast.notify is called with the toast props
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({ type: 'success', message: 'Already up to date' })
      })
    })

    it('should show update modal when update is available', async () => {
      // Arrange
      const releases = [{ version: '2.0.0' }]
      mockFetchReleases.mockResolvedValue(releases)
      mockCheckForUpdates.mockReturnValue({
        needUpdate: true,
        toastProps: { type: 'info', message: 'Update available' },
      })
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
        pluginUniqueIdentifier: 'test-id',
        category: 'model' as PluginCategoryEnum,
        meta: {
          repo: 'owner/repo',
          version: '1.0.0',
          package: 'pkg.difypkg',
        },
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      await waitFor(() => {
        expect(mockSetShowUpdatePluginModal).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              type: PluginSource.github,
              category: 'model',
              github: expect.objectContaining({
                originalPackageInfo: expect.objectContaining({
                  id: 'test-id',
                  repo: 'owner/repo',
                  version: '1.0.0',
                  package: 'pkg.difypkg',
                  releases,
                }),
              }),
            }),
          }),
        )
      })
    })

    it('should call invalidateInstalledPluginList on save callback', async () => {
      // Arrange
      const releases = [{ version: '2.0.0' }]
      mockFetchReleases.mockResolvedValue(releases)
      mockCheckForUpdates.mockReturnValue({
        needUpdate: true,
        toastProps: { type: 'info', message: 'Update available' },
      })
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Wait for modal to be called
      await waitFor(() => {
        expect(mockSetShowUpdatePluginModal).toHaveBeenCalled()
      })

      // Invoke the callback
      const call = mockSetShowUpdatePluginModal.mock.calls[0][0]
      call.onSaveCallback()

      // Assert
      expect(mockInvalidateInstalledPluginList).toHaveBeenCalled()
    })

    it('should check updates with current version', async () => {
      // Arrange
      const releases = [{ version: '2.0.0' }, { version: '1.5.0' }]
      mockFetchReleases.mockResolvedValue(releases)
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
        meta: {
          repo: 'owner/repo',
          version: '1.0.0',
          package: 'pkg.difypkg',
        },
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      await waitFor(() => {
        expect(mockCheckForUpdates).toHaveBeenCalledWith(releases, '1.0.0')
      })
    })
  })

  // ==================== Callback Stability Tests ====================
  describe('Callback Stability (useCallback)', () => {
    it('should have stable handleDelete callback with same dependencies', async () => {
      // Arrange
      mockUninstallPlugin.mockResolvedValue({ success: true })
      const onDelete = vi.fn()
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        onDelete,
        installationId: 'stable-install-id',
      })

      // Act - First render and delete
      const { rerender } = render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('stable-install-id')
      })

      // Re-render with same props
      mockUninstallPlugin.mockClear()
      rerender(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('stable-install-id')
      })
    })

    it('should update handleDelete when installationId changes', async () => {
      // Arrange
      mockUninstallPlugin.mockResolvedValue({ success: true })
      const props1 = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        installationId: 'install-1',
      })
      const props2 = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        installationId: 'install-2',
      })

      // Act
      const { rerender } = render(<Action {...props1} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('install-1')
      })

      mockUninstallPlugin.mockClear()
      rerender(<Action {...props2} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('install-2')
      })
    })

    it('should update handleDelete when onDelete changes', async () => {
      // Arrange
      mockUninstallPlugin.mockResolvedValue({ success: true })
      const onDelete1 = vi.fn()
      const onDelete2 = vi.fn()
      const props1 = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        onDelete: onDelete1,
      })
      const props2 = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        onDelete: onDelete2,
      })

      // Act
      const { rerender } = render(<Action {...props1} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(onDelete1).toHaveBeenCalled()
      })
      expect(onDelete2).not.toHaveBeenCalled()

      rerender(<Action {...props2} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(onDelete2).toHaveBeenCalled()
      })
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle undefined meta for info display', () => {
      // Arrange - meta is required for info, but test defensive behavior
      const props = createActionProps({
        isShowInfo: false,
        isShowDelete: true,
        isShowFetchNewVersion: false,
        meta: undefined,
      })

      // Act & Assert - Should not crash
      expect(() => render(<Action {...props} />)).not.toThrow()
    })

    it('should handle empty repo string', async () => {
      // Arrange
      mockFetchReleases.mockResolvedValue([{ version: '1.0.0' }])
      const props = createActionProps({
        isShowFetchNewVersion: true,
        isShowDelete: false,
        isShowInfo: false,
        author: 'fallback-owner',
        pluginName: 'fallback-repo',
        meta: {
          repo: '',
          version: '1.0.0',
          package: 'pkg.difypkg',
        },
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert - Should use author and pluginName as fallback
      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalledWith('fallback-owner', 'fallback-repo')
      })
    })

    it('should handle concurrent delete requests gracefully', async () => {
      // Arrange
      let resolveFirst: (value: { success: boolean }) => void
      const firstPromise = new Promise<{ success: boolean }>((resolve) => {
        resolveFirst = resolve
      })
      mockUninstallPlugin.mockReturnValueOnce(firstPromise)

      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // The confirm button should be disabled during deletion
      expect(screen.getByTestId('confirm-modal')).toHaveAttribute('data-loading', 'true')
      expect(screen.getByTestId('confirm-modal')).toHaveAttribute('data-disabled', 'true')

      // Resolve the deletion
      resolveFirst!({ success: true })

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
      })
    })

    it('should handle special characters in plugin name', () => {
      // Arrange
      const props = createActionProps({
        isShowDelete: true,
        isShowInfo: false,
        isShowFetchNewVersion: false,
        pluginName: 'plugin-with-special@chars#123',
      })

      // Act
      render(<Action {...props} />)
      fireEvent.click(getActionButtons()[0])

      // Assert
      expect(screen.getByText('plugin-with-special@chars#123')).toBeInTheDocument()
    })
  })

  // ==================== React.memo Tests ====================
  describe('React.memo Behavior', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(Action).toBeDefined()
      expect((Action as any).$$typeof?.toString()).toContain('Symbol')
    })
  })

  // ==================== Prop Variations ====================
  describe('Prop Variations', () => {
    it('should handle all category types', () => {
      // Arrange
      const categories = ['tool', 'model', 'extension', 'agent-strategy', 'datasource'] as PluginCategoryEnum[]

      categories.forEach((category) => {
        const props = createActionProps({
          category,
          isShowDelete: true,
          isShowInfo: false,
          isShowFetchNewVersion: false,
        })
        expect(() => render(<Action {...props} />)).not.toThrow()
      })
    })

    it('should handle different usedInApps values', () => {
      // Arrange
      const values = [0, 1, 5, 100]

      values.forEach((usedInApps) => {
        const props = createActionProps({
          usedInApps,
          isShowDelete: true,
          isShowInfo: false,
          isShowFetchNewVersion: false,
        })
        expect(() => render(<Action {...props} />)).not.toThrow()
      })
    })

    it('should handle combination of multiple action buttons', () => {
      // Arrange - Test various combinations
      const combinations = [
        { isShowFetchNewVersion: true, isShowInfo: false, isShowDelete: false },
        { isShowFetchNewVersion: false, isShowInfo: true, isShowDelete: false },
        { isShowFetchNewVersion: false, isShowInfo: false, isShowDelete: true },
        { isShowFetchNewVersion: true, isShowInfo: true, isShowDelete: false },
        { isShowFetchNewVersion: true, isShowInfo: false, isShowDelete: true },
        { isShowFetchNewVersion: false, isShowInfo: true, isShowDelete: true },
        { isShowFetchNewVersion: true, isShowInfo: true, isShowDelete: true },
      ]

      combinations.forEach((flags) => {
        const props = createActionProps(flags)
        const expectedCount = [flags.isShowFetchNewVersion, flags.isShowInfo, flags.isShowDelete].filter(Boolean).length

        const { unmount } = render(<Action {...props} />)
        const buttons = queryActionButtons()
        expect(buttons).toHaveLength(expectedCount)
        unmount()
      })
    })
  })
})
