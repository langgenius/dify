import type { FilterState } from '../filter-management'
import type { SystemFeatures } from '@/types/feature'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InstallationScope } from '@/types/feature'
import Empty from './index'

// ============================================================================
// Mock Setup
// ============================================================================

// Create a stable t function reference to avoid infinite re-renders
// The component's useEffect depends on t, so it must be stable
const stableT = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}))

// Mock useInstalledPluginList hook
const mockUseInstalledPluginList = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => mockUseInstalledPluginList(),
}))

// Mock system features from global public context
let mockSystemFeatures: Partial<SystemFeatures> = {
  enable_marketplace: true,
  plugin_installation_permission: {
    plugin_installation_scope: InstallationScope.ALL,
    restrict_to_marketplace_only: false,
  },
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: Partial<SystemFeatures> }) => unknown) =>
    selector({ systemFeatures: mockSystemFeatures }),
}))

// Mock plugin page context
let mockFilters: FilterState = {
  categories: [],
  tags: [],
  searchQuery: '',
}
const mockSetActiveTab = vi.fn()

vi.mock('../context', () => ({
  usePluginPageContext: (selector: (value: { filters: FilterState, setActiveTab: (tab: string) => void }) => unknown) =>
    selector({ filters: mockFilters, setActiveTab: mockSetActiveTab }),
}))

// Mock install components
vi.mock('@/app/components/plugins/install-plugin/install-from-github', () => ({
  default: ({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) => (
    <div data-testid="install-from-github">
      <button onClick={onClose} data-testid="github-close">Close</button>
      <button onClick={onSuccess} data-testid="github-success">Success</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file, onClose, onSuccess }: { file: File, onClose: () => void, onSuccess: () => void }) => (
    <div data-testid="install-from-local-package" data-filename={file.name}>
      <button onClick={onClose} data-testid="local-close">Close</button>
      <button onClick={onSuccess} data-testid="local-success">Success</button>
    </div>
  ),
}))

// Mock Line component
vi.mock('../../marketplace/empty/line', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="line" className={className} />
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createDefaultSystemFeatures = (overrides: Partial<SystemFeatures> = {}): Partial<SystemFeatures> => ({
  enable_marketplace: true,
  plugin_installation_permission: {
    plugin_installation_scope: InstallationScope.ALL,
    restrict_to_marketplace_only: false,
  },
  ...overrides,
})

const createFilterState = (overrides: Partial<FilterState> = {}): FilterState => ({
  categories: [],
  tags: [],
  searchQuery: '',
  ...overrides,
})

const createPluginListResponse = (plugins: unknown[] = []) => ({
  data: {
    plugins,
    total: plugins.length,
  },
})

// ============================================================================
// Rendering Tests
// ============================================================================
describe('Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures = createDefaultSystemFeatures()
    mockFilters = createFilterState()
    mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([]))
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.list.noInstalled')).toBeInTheDocument()
    })

    it('should render skeleton grid background', () => {
      // Arrange & Act
      const { container } = render(<Empty />)

      // Assert
      const skeletonCards = container.querySelectorAll('.h-24.rounded-xl.bg-components-card-bg')
      expect(skeletonCards.length).toBe(20)
    })

    it('should render Group icon', () => {
      // Arrange & Act
      const { container } = render(<Empty />)

      // Assert
      const iconContainer = container.querySelector('.size-14')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render decorative lines', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      const lines = screen.getAllByTestId('line')
      expect(lines.length).toBe(4)
    })

    it('should be wrapped with React.memo', () => {
      // Assert - React.memo components have $$typeof Symbol(react.memo)
      expect(Empty.$$typeof?.toString()).toBe('Symbol(react.memo)')
    })

    it('should have displayName set on inner component', () => {
      // Assert - displayName is set on the inner component (type property of memo wrapper)
      const innerComponent = (Empty as unknown as { type: { displayName?: string } }).type
      expect(innerComponent?.displayName).toBe('Empty')
    })
  })

  // ============================================================================
  // State Management Tests
  // ============================================================================
  describe('State Management', () => {
    it('should initialize with no selected action', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      expect(screen.queryByTestId('install-from-github')).not.toBeInTheDocument()
      expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
    })

    it('should update selectedAction when github button is clicked', async () => {
      // Arrange
      render(<Empty />)

      // Act
      const githubButton = screen.getByText('plugin.source.github')
      await userEvent.click(githubButton)

      // Assert
      expect(screen.getByTestId('install-from-github')).toBeInTheDocument()
    })

    it('should clear selectedAction when github modal is closed', async () => {
      // Arrange
      render(<Empty />)

      // Act - Open then close
      await userEvent.click(screen.getByText('plugin.source.github'))
      expect(screen.getByTestId('install-from-github')).toBeInTheDocument()

      await userEvent.click(screen.getByTestId('github-close'))

      // Assert
      expect(screen.queryByTestId('install-from-github')).not.toBeInTheDocument()
    })

    it('should update selectedFile when file is selected', async () => {
      // Arrange
      render(<Empty />)
      const file = new File(['test content'], 'test.difypkg', { type: 'application/octet-stream' })

      // Act
      const localButton = screen.getByText('plugin.source.local')
      await userEvent.click(localButton)

      // Get the hidden file input and simulate file selection
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeInTheDocument()

      // Simulate file change
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      })
      fireEvent.change(fileInput)

      // Assert
      await waitFor(() => {
        const localPackageModal = screen.getByTestId('install-from-local-package')
        expect(localPackageModal).toBeInTheDocument()
        expect(localPackageModal).toHaveAttribute('data-filename', 'test.difypkg')
      })
    })

    it('should clear selectedAction when local package modal is closed', async () => {
      // Arrange
      render(<Empty />)
      const file = new File(['test'], 'test.difypkg', { type: 'application/octet-stream' })

      // Act - Select file
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('install-from-local-package')).toBeInTheDocument()
      })

      // Close the modal
      await userEvent.click(screen.getByTestId('local-close'))

      // Assert
      expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
    })
  })

  // ============================================================================
  // Side Effects and Cleanup Tests
  // ============================================================================
  describe('Side Effects and Cleanup', () => {
    it('should update install methods when system features change', () => {
      // Arrange
      mockSystemFeatures = createDefaultSystemFeatures({
        enable_marketplace: false,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: false,
        },
      })

      // Act
      render(<Empty />)

      // Assert - Marketplace option should not be visible
      expect(screen.queryByText('plugin.source.marketplace')).not.toBeInTheDocument()
      expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
      expect(screen.getByText('plugin.source.local')).toBeInTheDocument()
    })

    it('should only show marketplace when restrict_to_marketplace_only is true', () => {
      // Arrange
      mockSystemFeatures = createDefaultSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: true,
        },
      })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
      expect(screen.queryByText('plugin.source.github')).not.toBeInTheDocument()
      expect(screen.queryByText('plugin.source.local')).not.toBeInTheDocument()
    })
  })

  // ============================================================================
  // Memoization Logic Tests
  // ============================================================================
  describe('Memoization Logic', () => {
    it('should show noInstalled text when plugin list is empty', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([]))

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.list.noInstalled')).toBeInTheDocument()
    })

    it('should show notFound text when filters are active with no results', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([{ id: '1' }]))
      mockFilters = createFilterState({ categories: ['model'] })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    })

    it('should show notFound text when tags filter is active', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([{ id: '1' }]))
      mockFilters = createFilterState({ tags: ['agent'] })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    })

    it('should show notFound text when searchQuery is active', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([{ id: '1' }]))
      mockFilters = createFilterState({ searchQuery: 'test' })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    })

    it('should update text based on filter and plugin list state', () => {
      // Test noInstalled when plugin list is empty
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([]))
      mockFilters = createFilterState()

      const { unmount } = render(<Empty />)
      expect(screen.getByText('plugin.list.noInstalled')).toBeInTheDocument()
      unmount()

      // Test notFound when filters are active with plugins present
      mockFilters = createFilterState({ categories: ['model'] })
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([{ id: '1' }]))

      render(<Empty />)
      expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // User Interactions Tests
  // ============================================================================
  describe('User Interactions', () => {
    it('should navigate to discover tab when marketplace button is clicked', async () => {
      // Arrange
      mockSystemFeatures = createDefaultSystemFeatures({ enable_marketplace: true })
      render(<Empty />)

      // Act
      await userEvent.click(screen.getByText('plugin.source.marketplace'))

      // Assert
      expect(mockSetActiveTab).toHaveBeenCalledWith('discover')
    })

    it('should trigger file input click when local button is clicked', async () => {
      // Arrange
      render(<Empty />)
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      // Act
      await userEvent.click(screen.getByText('plugin.source.local'))

      // Assert
      expect(clickSpy).toHaveBeenCalled()
    })

    it('should not show modals for unselected file', async () => {
      // Arrange
      render(<Empty />)

      // Act - Click local but don't select a file
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(fileInput, { target: { files: [] } })

      // Assert
      expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
    })

    it('should handle file input change event', async () => {
      // Arrange
      render(<Empty />)
      const testFile = new File(['content'], 'plugin.difypkg', { type: 'application/octet-stream' })

      // Act
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', {
        value: [testFile],
        configurable: true,
      })
      fireEvent.change(fileInput)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('install-from-local-package')).toBeInTheDocument()
      })
    })

    it('should render buttons with correct styling', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveClass('justify-start')
      })
    })
  })

  // ============================================================================
  // Component Memoization Tests
  // ============================================================================
  describe('Component Memoization', () => {
    it('should not rerender when unrelated props change', () => {
      // Arrange
      const renderCount = vi.fn()
      const TestWrapper = () => {
        renderCount()
        return <Empty />
      }

      // Act
      const { rerender } = render(<TestWrapper />)
      rerender(<TestWrapper />)

      // Assert - Initial render + rerender
      expect(renderCount).toHaveBeenCalledTimes(2)
    })

    it('should maintain stable reference for install methods', () => {
      // Arrange & Act
      const { container, rerender } = render(<Empty />)
      const initialButtons = container.querySelectorAll('button')

      rerender(<Empty />)
      const afterRerenderButtons = container.querySelectorAll('button')

      // Assert
      expect(initialButtons.length).toBe(afterRerenderButtons.length)
    })
  })

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle undefined plugin list data', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue({ data: undefined })

      // Act
      render(<Empty />)

      // Assert - Should still render without crashing
      expect(screen.getByRole('button', { name: /github/i })).toBeInTheDocument()
    })

    it('should handle null plugin list', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue({ data: null })

      // Act
      render(<Empty />)

      // Assert
      expect(document.querySelector('.relative.z-0.w-full.grow')).toBeInTheDocument()
    })

    it('should handle empty system features', () => {
      // Arrange
      mockSystemFeatures = {
        enable_marketplace: false,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.NONE,
          restrict_to_marketplace_only: false,
        },
      }

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
    })

    it('should handle multiple file selection attempts', async () => {
      // Arrange
      render(<Empty />)
      const file1 = new File(['content1'], 'plugin1.difypkg')
      const file2 = new File(['content2'], 'plugin2.difypkg')

      // Act - First file
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', { value: [file1], configurable: true })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-filename', 'plugin1.difypkg')
      })

      // Close and select another
      await userEvent.click(screen.getByTestId('local-close'))

      Object.defineProperty(fileInput, 'files', { value: [file2], configurable: true })
      fireEvent.change(fileInput)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-filename', 'plugin2.difypkg')
      })
    })

    it('should handle rapid button clicks', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<Empty />)

      // Act - Rapidly click different buttons
      await user.click(screen.getByText('plugin.source.github'))
      await user.click(screen.getByTestId('github-close'))
      await user.click(screen.getByText('plugin.source.marketplace'))

      // Assert
      expect(mockSetActiveTab).toHaveBeenCalledWith('discover')
    })
  })

  // ============================================================================
  // Prop Variations Tests
  // ============================================================================
  describe('Prop Variations', () => {
    it('should render all install methods when all permissions are granted', () => {
      // Arrange
      mockSystemFeatures = createDefaultSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: false,
        },
      })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
      expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
      expect(screen.getByText('plugin.source.local')).toBeInTheDocument()
    })

    it('should render only marketplace when restricted', () => {
      // Arrange
      mockSystemFeatures = createDefaultSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.OFFICIAL_ONLY,
          restrict_to_marketplace_only: true,
        },
      })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
      expect(screen.queryByText('plugin.source.github')).not.toBeInTheDocument()
      expect(screen.queryByText('plugin.source.local')).not.toBeInTheDocument()
    })

    it('should render github and local when marketplace is disabled', () => {
      // Arrange
      mockSystemFeatures = createDefaultSystemFeatures({
        enable_marketplace: false,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: false,
        },
      })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.queryByText('plugin.source.marketplace')).not.toBeInTheDocument()
      expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
      expect(screen.getByText('plugin.source.local')).toBeInTheDocument()
    })

    it('should handle filter combinations for text display', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue(createPluginListResponse([{ id: '1' }]))
      mockFilters = createFilterState({
        categories: ['model'],
        tags: ['agent'],
        searchQuery: 'test',
      })

      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // API Calls Tests
  // ============================================================================
  describe('API Calls', () => {
    it('should call useInstalledPluginList on mount', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      expect(mockUseInstalledPluginList).toHaveBeenCalled()
    })

    it('should handle plugin list loading state', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue({
        data: undefined,
        isLoading: true,
      })

      // Act
      render(<Empty />)

      // Assert - Component should still render
      expect(document.querySelector('.relative.z-0.w-full.grow')).toBeInTheDocument()
    })

    it('should handle plugin list error state', () => {
      // Arrange
      mockUseInstalledPluginList.mockReturnValue({
        data: undefined,
        error: new Error('Failed to fetch'),
      })

      // Act
      render(<Empty />)

      // Assert - Component should still render gracefully
      expect(document.querySelector('.relative.z-0.w-full.grow')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // File Input Tests
  // ============================================================================
  describe('File Input', () => {
    it('should have correct accept attribute', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toHaveAttribute('accept', '.difypkg,.difybndl')
    })

    it('should be hidden from view', () => {
      // Arrange & Act
      render(<Empty />)

      // Assert
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toHaveStyle({ display: 'none' })
    })

    it('should handle file input ref correctly', async () => {
      // Arrange
      render(<Empty />)

      // Act
      const localButton = screen.getByText('plugin.source.local')
      await userEvent.click(localButton)

      // Assert - File input should have been accessed via ref
      const fileInput = document.querySelector('input[type="file"]')
      expect(fileInput).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================
  describe('Integration', () => {
    it('should complete full workflow: click github -> close modal', async () => {
      // Arrange
      render(<Empty />)

      // Act
      await userEvent.click(screen.getByText('plugin.source.github'))
      expect(screen.getByTestId('install-from-github')).toBeInTheDocument()

      await userEvent.click(screen.getByTestId('github-close'))

      // Assert
      expect(screen.queryByTestId('install-from-github')).not.toBeInTheDocument()
    })

    it('should complete full workflow: select file -> close modal', async () => {
      // Arrange
      render(<Empty />)
      const testFile = new File(['test'], 'test.difypkg')

      // Act
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', { value: [testFile], configurable: true })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('install-from-local-package')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByTestId('local-close'))

      // Assert
      expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
    })

    it('should switch between modals correctly', async () => {
      // Arrange
      render(<Empty />)

      // Act - Open GitHub modal
      await userEvent.click(screen.getByText('plugin.source.github'))
      expect(screen.getByTestId('install-from-github')).toBeInTheDocument()

      // Close and navigate to marketplace
      await userEvent.click(screen.getByTestId('github-close'))
      await userEvent.click(screen.getByText('plugin.source.marketplace'))

      // Assert
      expect(mockSetActiveTab).toHaveBeenCalledWith('discover')
      expect(screen.queryByTestId('install-from-github')).not.toBeInTheDocument()
    })
  })

  // ============================================================================
  // Conditional Rendering Tests
  // ============================================================================
  describe('Conditional Rendering', () => {
    it('should show github modal only when selectedAction is github', async () => {
      // Arrange
      render(<Empty />)

      // Assert - Initially hidden
      expect(screen.queryByTestId('install-from-github')).not.toBeInTheDocument()

      // Act
      await userEvent.click(screen.getByText('plugin.source.github'))

      // Assert - Now visible
      expect(screen.getByTestId('install-from-github')).toBeInTheDocument()
    })

    it('should show local package modal only when action is local AND file is selected', async () => {
      // Arrange
      render(<Empty />)

      // Assert - Initially hidden
      expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()

      // Act - Click local button (triggers file picker, but no file selected yet)
      // We need to simulate file selection
      const testFile = new File(['content'], 'test.difypkg')
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', { value: [testFile], configurable: true })
      fireEvent.change(fileInput)

      // Assert - Now visible with file
      await waitFor(() => {
        expect(screen.getByTestId('install-from-local-package')).toBeInTheDocument()
      })
    })

    it('should not show local package modal if no file is selected', () => {
      // Arrange
      render(<Empty />)

      // Assert
      expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
    })
  })
})
