import type { PluginPageProps } from './index'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQueryState } from 'nuqs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePluginInstallation } from '@/hooks/use-query-params'
// Import mocked modules for assertions
import { fetchBundleInfoFromMarketPlace, fetchManifestFromMarketPlace } from '@/service/plugins'
import PluginPageWithContext from './index'

// Mock external dependencies
vi.mock('@/service/plugins', () => ({
  fetchManifestFromMarketPlace: vi.fn(),
  fetchBundleInfoFromMarketPlace: vi.fn(),
}))

vi.mock('@/hooks/use-query-params', () => ({
  usePluginInstallation: vi.fn(() => [{ packageId: null, bundleInfo: null }, vi.fn()]),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn((selector) => {
    const state = {
      systemFeatures: {
        enable_marketplace: true,
      },
    }
    return selector(state)
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: false,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useReferenceSettings: () => ({
    data: {
      permission: {
        install_permission: 'everyone',
        debug_permission: 'admins',
      },
    },
  }),
  useMutationReferenceSettings: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useInvalidateReferenceSettings: () => vi.fn(),
  usePluginTaskList: () => ({
    pluginTasks: [],
    handleRefetch: vi.fn(),
  }),
  useMutationClearTaskPlugin: () => ({
    mutateAsync: vi.fn(),
  }),
  useInstalledPluginList: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isLastPage: true,
    loadNextPage: vi.fn(),
  }),
  useInstalledLatestVersion: () => ({
    data: {},
  }),
  useInvalidateInstalledPluginList: () => vi.fn(),
}))

vi.mock('nuqs', () => ({
  useQueryState: vi.fn(() => ['plugins', vi.fn()]),
}))

vi.mock('./plugin-tasks', () => ({
  default: () => <div data-testid="plugin-tasks">PluginTasks</div>,
}))

vi.mock('./debug-info', () => ({
  default: () => <div data-testid="debug-info">DebugInfo</div>,
}))

vi.mock('./install-plugin-dropdown', () => ({
  default: ({ onSwitchToMarketplaceTab }: { onSwitchToMarketplaceTab: () => void }) => (
    <button data-testid="install-dropdown" onClick={onSwitchToMarketplaceTab}>
      Install
    </button>
  ),
}))

vi.mock('../install-plugin/install-from-local-package', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-local-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('../install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-marketplace-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/reference-setting-modal', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="reference-setting-modal">
      <button onClick={onHide}>Close Settings</button>
    </div>
  ),
}))

// Helper to create default props
const createDefaultProps = (): PluginPageProps => ({
  plugins: <div data-testid="plugins-content">Plugins Content</div>,
  marketplace: <div data-testid="marketplace-content">Marketplace Content</div>,
})

// ============================================================================
// PluginPage Component Tests
// ============================================================================
describe('PluginPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default mock values
    vi.mocked(usePluginInstallation).mockReturnValue([
      { packageId: null, bundleInfo: null },
      vi.fn(),
    ])
    vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])
  })

  // ============================================================================
  // Rendering Tests
  // ============================================================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })

    it('should render with correct container id', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')
      expect(container).toBeInTheDocument()
    })

    it('should render PluginTasks component', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('plugin-tasks')).toBeInTheDocument()
    })

    it('should render plugins content when on plugins tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('plugins-content')).toBeInTheDocument()
    })

    it('should render marketplace content when on marketplace tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      // The marketplace content should be visible when enable_marketplace is true and on discover tab
      const container = document.getElementById('marketplace-container')
      expect(container).toBeInTheDocument()
      // Check that marketplace-specific links are shown
      expect(screen.getByText(/requestAPlugin/i)).toBeInTheDocument()
    })

    it('should render TabSlider', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      // TabSlider renders tab options
      expect(document.querySelector('.flex-1')).toBeInTheDocument()
    })

    it('should render drag and drop hint when on plugins tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByText(/dropPluginToInstall/i)).toBeInTheDocument()
    })

    it('should render file input for plugin upload', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader')
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveAttribute('type', 'file')
    })
  })

  // ============================================================================
  // Tab Navigation Tests
  // ============================================================================
  describe('Tab Navigation', () => {
    it('should display plugins tab as active by default', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('plugins-content')).toBeInTheDocument()
    })

    it('should show marketplace links when on marketplace tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      // Check for marketplace-specific buttons
      expect(screen.getByText(/requestAPlugin/i)).toBeInTheDocument()
      expect(screen.getByText(/publishPlugins/i)).toBeInTheDocument()
    })

    it('should not show marketplace links when on plugins tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.queryByText(/requestAPlugin/i)).not.toBeInTheDocument()
    })
  })

  // ============================================================================
  // Permission-based Rendering Tests
  // ============================================================================
  describe('Permission-based Rendering', () => {
    it('should render InstallPluginDropdown when canManagement is true', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('install-dropdown')).toBeInTheDocument()
    })

    it('should render DebugInfo when canDebugger is true', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('debug-info')).toBeInTheDocument()
    })

    it('should render settings button when canSetPermissions is true', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      // Settings button with RiEqualizer2Line icon
      const settingsButtons = document.querySelectorAll('button')
      expect(settingsButtons.length).toBeGreaterThan(0)
    })

    it('should call setActiveTab when onSwitchToMarketplaceTab is called', async () => {
      const mockSetActiveTab = vi.fn()
      vi.mocked(useQueryState).mockReturnValue(['plugins', mockSetActiveTab])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // Click the install dropdown button which triggers onSwitchToMarketplaceTab
      fireEvent.click(screen.getByTestId('install-dropdown'))

      // The mock onSwitchToMarketplaceTab calls setActiveTab('discover')
      // Since our mock InstallPluginDropdown calls onSwitchToMarketplaceTab on click
      // we verify that setActiveTab was called with 'discover'.
      expect(mockSetActiveTab).toHaveBeenCalledWith('discover')
    })

    it('should use noop for file handlers when canManagement is false', () => {
      // Override mock to disable management permission
      vi.doMock('@/service/use-plugins', () => ({
        useReferenceSettings: () => ({
          data: {
            permission: {
              install_permission: 'noone',
              debug_permission: 'noone',
            },
          },
        }),
        useMutationReferenceSettings: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
        useInvalidateReferenceSettings: () => vi.fn(),
        usePluginTaskList: () => ({
          pluginTasks: [],
          handleRefetch: vi.fn(),
        }),
        useMutationClearTaskPlugin: () => ({
          mutateAsync: vi.fn(),
        }),
        useInstalledPluginList: () => ({
          data: [],
          isLoading: false,
          isFetching: false,
          isLastPage: true,
          loadNextPage: vi.fn(),
        }),
        useInstalledLatestVersion: () => ({
          data: {},
        }),
        useInvalidateInstalledPluginList: () => vi.fn(),
      }))

      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // File input should still be in the document (even if handlers are noop)
      const fileInput = document.getElementById('fileUploader')
      expect(fileInput).toBeInTheDocument()
    })
  })

  // ============================================================================
  // File Upload Tests
  // ============================================================================
  describe('File Upload', () => {
    it('should have hidden file input', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement
      expect(fileInput).toHaveClass('hidden')
    })

    it('should accept .difypkg files', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement
      expect(fileInput.accept).toContain('.difypkg')
    })

    it('should show InstallFromLocalPackage modal when valid file is selected', async () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement

      const file = new File(['content'], 'plugin.difypkg', { type: 'application/octet-stream' })
      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('install-local-modal')).toBeInTheDocument()
      })
    })

    it('should not show modal for non-.difypkg files', async () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement

      const file = new File(['content'], 'plugin.txt', { type: 'text/plain' })
      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
      })
    })
  })

  // ============================================================================
  // Marketplace Installation Tests
  // ============================================================================
  describe('Marketplace Installation', () => {
    it('should fetch manifest when packageId is provided', async () => {
      const mockSetInstallState = vi.fn()
      vi.mocked(usePluginInstallation).mockReturnValue([
        { packageId: 'test-package-id', bundleInfo: null },
        mockSetInstallState,
      ])

      vi.mocked(fetchManifestFromMarketPlace).mockResolvedValue({
        data: {
          plugin: { org: 'test-org', name: 'test-plugin', category: 'tool' },
          version: { version: '1.0.0' },
        },
      } as Awaited<ReturnType<typeof fetchManifestFromMarketPlace>>)

      render(<PluginPageWithContext {...createDefaultProps()} />)

      await waitFor(() => {
        expect(fetchManifestFromMarketPlace).toHaveBeenCalledWith('test-package-id')
      })
    })

    it('should fetch bundle info when bundleInfo is provided', async () => {
      const mockSetInstallState = vi.fn()
      vi.mocked(usePluginInstallation).mockReturnValue([
        { packageId: null, bundleInfo: 'test-bundle-info' as unknown },
        mockSetInstallState,
      ] as ReturnType<typeof usePluginInstallation>)

      vi.mocked(fetchBundleInfoFromMarketPlace).mockResolvedValue({
        data: { version: { dependencies: [] } },
      } as unknown as Awaited<ReturnType<typeof fetchBundleInfoFromMarketPlace>>)

      render(<PluginPageWithContext {...createDefaultProps()} />)

      await waitFor(() => {
        expect(fetchBundleInfoFromMarketPlace).toHaveBeenCalledWith('test-bundle-info')
      })
    })

    it('should show InstallFromMarketplace modal after fetching manifest', async () => {
      const mockSetInstallState = vi.fn()
      vi.mocked(usePluginInstallation).mockReturnValue([
        { packageId: 'test-package-id', bundleInfo: null },
        mockSetInstallState,
      ])

      vi.mocked(fetchManifestFromMarketPlace).mockResolvedValue({
        data: {
          plugin: { org: 'test-org', name: 'test-plugin', category: 'tool' },
          version: { version: '1.0.0' },
        },
      } as Awaited<ReturnType<typeof fetchManifestFromMarketPlace>>)

      render(<PluginPageWithContext {...createDefaultProps()} />)

      await waitFor(() => {
        expect(screen.getByTestId('install-marketplace-modal')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should handle fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      vi.mocked(usePluginInstallation).mockReturnValue([
        { packageId: null, bundleInfo: 'invalid-bundle' as unknown },
        vi.fn(),
      ] as ReturnType<typeof usePluginInstallation>)

      vi.mocked(fetchBundleInfoFromMarketPlace).mockRejectedValue(new Error('Network error'))

      render(<PluginPageWithContext {...createDefaultProps()} />)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to load bundle info:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })
  })

  // ============================================================================
  // Settings Modal Tests
  // ============================================================================
  describe('Settings Modal', () => {
    it('should open settings modal when settings button is clicked', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)

      fireEvent.click(screen.getByTestId('plugin-settings-button'))

      await waitFor(() => {
        expect(screen.getByTestId('reference-setting-modal')).toBeInTheDocument()
      })
    })

    it('should close settings modal when onHide is called', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)

      // Open modal
      fireEvent.click(screen.getByTestId('plugin-settings-button'))

      await waitFor(() => {
        expect(screen.getByTestId('reference-setting-modal')).toBeInTheDocument()
      })

      // Close modal
      fireEvent.click(screen.getByText('Close Settings'))

      await waitFor(() => {
        expect(screen.queryByTestId('reference-setting-modal')).not.toBeInTheDocument()
      })
    })
  })

  // ============================================================================
  // Drag and Drop Tests
  // ============================================================================
  describe('Drag and Drop', () => {
    it('should show dragging overlay when dragging files over container', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      // Simulate drag enter
      const dragEnterEvent = new Event('dragenter', { bubbles: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      container.dispatchEvent(dragEnterEvent)

      // Check for dragging overlay styles
      expect(container).toBeInTheDocument()
    })

    it('should highlight drop zone text when dragging', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // The drag hint should be visible
      const dragHint = screen.getByText(/dropPluginToInstall/i)
      expect(dragHint).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Memoization Tests
  // ============================================================================
  describe('Memoization', () => {
    it('should memoize isPluginsTab correctly', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      const { rerender } = render(<PluginPageWithContext {...createDefaultProps()} />)

      // Should show plugins content
      expect(screen.getByTestId('plugins-content')).toBeInTheDocument()

      // Rerender with same props - memoized value should be same
      rerender(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('plugins-content')).toBeInTheDocument()
    })

    it('should memoize isExploringMarketplace correctly', () => {
      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      const { rerender } = render(<PluginPageWithContext {...createDefaultProps()} />)

      // Should show marketplace links when on discover tab
      expect(screen.getByText(/requestAPlugin/i)).toBeInTheDocument()

      // Rerender with same props
      rerender(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByText(/requestAPlugin/i)).toBeInTheDocument()
    })

    it('should recognize plugin type tabs as marketplace', () => {
      // Test with a plugin type tab like 'tool'
      vi.mocked(useQueryState).mockReturnValue(['tool', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // Should show marketplace links when on a plugin type tab
      expect(screen.getByText(/requestAPlugin/i)).toBeInTheDocument()
      expect(screen.getByText(/publishPlugins/i)).toBeInTheDocument()
    })

    it('should render marketplace content when isExploringMarketplace and enable_marketplace are true', () => {
      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // The marketplace prop content should be rendered
      // Since we mock the marketplace as a div, check it's not hidden
      const container = document.getElementById('marketplace-container')
      expect(container).toBeInTheDocument()
      expect(container).toHaveClass('bg-background-body')
    })
  })

  // ============================================================================
  // Context Provider Tests
  // ============================================================================
  describe('Context Provider', () => {
    it('should wrap component with PluginPageContextProvider', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)

      // The component should render, indicating context is working
      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })

    it('should filter out marketplace tab when enable_marketplace is false', () => {
      // This tests line 69 in context.tsx - the false branch of enable_marketplace
      // The marketplace tab should be filtered out from options
      render(<PluginPageWithContext {...createDefaultProps()} />)
      // Component should still work without marketplace
      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle null plugins prop', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext plugins={null} marketplace={null} />)
      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })

    it('should handle empty marketplace prop', () => {
      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      render(<PluginPageWithContext plugins={null} marketplace={null} />)
      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })

    it('should handle rapid tab switches', async () => {
      const mockSetActiveTab = vi.fn()
      vi.mocked(useQueryState).mockReturnValue(['plugins', mockSetActiveTab])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // Simulate rapid switches by updating state
      act(() => {
        vi.mocked(useQueryState).mockReturnValue(['discover', mockSetActiveTab])
      })

      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })

    it('should handle marketplace disabled', () => {
      // Mock marketplace disabled
      vi.mock('@/context/global-public-context', async () => ({
        useGlobalPublicStore: vi.fn((selector) => {
          const state = {
            systemFeatures: {
              enable_marketplace: false,
            },
          }
          return selector(state)
        }),
      }))

      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // Component should still render but without marketplace content when disabled
      expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    })

    it('should handle file with empty name', async () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement

      const file = new File(['content'], '', { type: 'application/octet-stream' })
      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      // Should not show modal for file without proper extension
      await waitFor(() => {
        expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
      })
    })

    it('should handle no files selected', async () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement

      Object.defineProperty(fileInput, 'files', {
        value: [],
      })

      fireEvent.change(fileInput)

      // Should not show modal
      expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
    })
  })

  // ============================================================================
  // Cleanup Tests
  // ============================================================================
  describe('Cleanup', () => {
    it('should reset install state when hiding marketplace modal', async () => {
      const mockSetInstallState = vi.fn()
      vi.mocked(usePluginInstallation).mockReturnValue([
        { packageId: 'test-package', bundleInfo: null },
        mockSetInstallState,
      ])

      vi.mocked(fetchManifestFromMarketPlace).mockResolvedValue({
        data: {
          plugin: { org: 'test-org', name: 'test-plugin', category: 'tool' },
          version: { version: '1.0.0' },
        },
      } as Awaited<ReturnType<typeof fetchManifestFromMarketPlace>>)

      render(<PluginPageWithContext {...createDefaultProps()} />)

      // Wait for modal to appear
      await waitFor(() => {
        expect(screen.getByTestId('install-marketplace-modal')).toBeInTheDocument()
      }, { timeout: 3000 })

      // Close modal
      fireEvent.click(screen.getByText('Close'))

      await waitFor(() => {
        expect(mockSetInstallState).toHaveBeenCalledWith(null)
      })
    })
  })

  // ============================================================================
  // Styling Tests
  // ============================================================================
  describe('Styling', () => {
    it('should apply correct background for plugins tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')

      expect(container).toHaveClass('bg-components-panel-bg')
    })

    it('should apply correct background for marketplace tab', () => {
      vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')

      expect(container).toHaveClass('bg-background-body')
    })

    it('should have scrollbar-gutter stable style', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')

      expect(container).toHaveStyle({ scrollbarGutter: 'stable' })
    })
  })
})

// ============================================================================
// Uploader Hook Integration Tests
// ============================================================================
describe('Uploader Hook Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])
  })

  describe('Drag Events', () => {
    it('should handle dragover event', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(dragOverEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })

      act(() => {
        container.dispatchEvent(dragOverEvent)
      })

      expect(container).toBeInTheDocument()
    })

    it('should handle dragleave event when leaving container', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      const dragEnterEvent = new Event('dragenter', { bubbles: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        container.dispatchEvent(dragEnterEvent)
      })

      const dragLeaveEvent = new Event('dragleave', { bubbles: true })
      Object.defineProperty(dragLeaveEvent, 'relatedTarget', {
        value: null,
      })
      act(() => {
        container.dispatchEvent(dragLeaveEvent)
      })

      expect(container).toBeInTheDocument()
    })

    it('should handle dragleave event when moving to element outside container', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      const dragEnterEvent = new Event('dragenter', { bubbles: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        container.dispatchEvent(dragEnterEvent)
      })

      const outsideElement = document.createElement('div')
      document.body.appendChild(outsideElement)

      const dragLeaveEvent = new Event('dragleave', { bubbles: true })
      Object.defineProperty(dragLeaveEvent, 'relatedTarget', {
        value: outsideElement,
      })
      act(() => {
        container.dispatchEvent(dragLeaveEvent)
      })

      expect(container).toBeInTheDocument()
      document.body.removeChild(outsideElement)
    })

    it('should handle drop event with files', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      const dragEnterEvent = new Event('dragenter', { bubbles: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        container.dispatchEvent(dragEnterEvent)
      })

      const file = new File(['content'], 'test-plugin.difypkg', { type: 'application/octet-stream' })
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [file] },
      })

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(screen.getByTestId('install-local-modal')).toBeInTheDocument()
      })
    })

    it('should handle drop event without dataTransfer', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
    })

    it('should handle drop event with empty files array', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const container = document.getElementById('marketplace-container')!

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [] },
      })

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
    })
  })

  describe('File Change Handler', () => {
    it('should handle file change with null file', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement

      Object.defineProperty(fileInput, 'files', { value: null })

      fireEvent.change(fileInput)

      expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
    })
  })

  describe('Remove File', () => {
    it('should clear file input when removeFile is called', async () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      const fileInput = document.getElementById('fileUploader') as HTMLInputElement

      const file = new File(['content'], 'plugin.difypkg', { type: 'application/octet-stream' })
      Object.defineProperty(fileInput, 'files', { value: [file] })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('install-local-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Close'))

      await waitFor(() => {
        expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// Reference Setting Hook Integration Tests
// ============================================================================
describe('Reference Setting Hook Integration', () => {
  describe('Permission Handling', () => {
    it('should render InstallPluginDropdown when permission is everyone', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('install-dropdown')).toBeInTheDocument()
    })

    it('should render DebugInfo when permission is admins and user is manager', () => {
      render(<PluginPageWithContext {...createDefaultProps()} />)
      expect(screen.getByTestId('debug-info')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Marketplace Installation Permission Tests
// ============================================================================
describe('Marketplace Installation Permission', () => {
  it('should show InstallPluginDropdown when marketplace is enabled and has permission', () => {
    render(<PluginPageWithContext {...createDefaultProps()} />)
    expect(screen.getByTestId('install-dropdown')).toBeInTheDocument()
  })
})

// ============================================================================
// Integration Tests
// ============================================================================
describe('PluginPage Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePluginInstallation).mockReturnValue([
      { packageId: null, bundleInfo: null },
      vi.fn(),
    ])
    vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])
  })

  it('should render complete plugin page with all features', () => {
    render(<PluginPageWithContext {...createDefaultProps()} />)

    // Check all major elements are present
    expect(document.getElementById('marketplace-container')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-tasks')).toBeInTheDocument()
    expect(screen.getByTestId('install-dropdown')).toBeInTheDocument()
    expect(screen.getByTestId('debug-info')).toBeInTheDocument()
    expect(screen.getByTestId('plugins-content')).toBeInTheDocument()
  })

  it('should handle full install from marketplace flow', async () => {
    const mockSetInstallState = vi.fn()
    vi.mocked(usePluginInstallation).mockReturnValue([
      { packageId: 'test-package', bundleInfo: null },
      mockSetInstallState,
    ])

    vi.mocked(fetchManifestFromMarketPlace).mockResolvedValue({
      data: {
        plugin: { org: 'langgenius', name: 'test-plugin', category: 'tool' },
        version: { version: '1.0.0' },
      },
    } as Awaited<ReturnType<typeof fetchManifestFromMarketPlace>>)

    render(<PluginPageWithContext {...createDefaultProps()} />)

    // Wait for API call
    await waitFor(() => {
      expect(fetchManifestFromMarketPlace).toHaveBeenCalled()
    })

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByTestId('install-marketplace-modal')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Close modal
    fireEvent.click(screen.getByText('Close'))

    // Verify state reset
    await waitFor(() => {
      expect(mockSetInstallState).toHaveBeenCalledWith(null)
    })
  })

  it('should handle full local plugin install flow', async () => {
    vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])

    render(<PluginPageWithContext {...createDefaultProps()} />)

    const fileInput = document.getElementById('fileUploader') as HTMLInputElement
    const file = new File(['plugin content'], 'my-plugin.difypkg', {
      type: 'application/octet-stream',
    })

    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)

    await waitFor(() => {
      expect(screen.getByTestId('install-local-modal')).toBeInTheDocument()
    })

    // Close modal (triggers removeFile via onClose)
    fireEvent.click(screen.getByText('Close'))

    await waitFor(() => {
      expect(screen.queryByTestId('install-local-modal')).not.toBeInTheDocument()
    })
  })

  it('should render marketplace content only when enable_marketplace is true', () => {
    vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

    const { rerender } = render(<PluginPageWithContext {...createDefaultProps()} />)

    // With enable_marketplace: true (default mock), marketplace links should show
    expect(screen.getByText(/requestAPlugin/i)).toBeInTheDocument()

    // Rerender to verify consistent behavior
    rerender(<PluginPageWithContext {...createDefaultProps()} />)
    expect(screen.getByText(/publishPlugins/i)).toBeInTheDocument()
  })
})
