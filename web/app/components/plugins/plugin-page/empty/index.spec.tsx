import type { FilterState } from '../filter-management'
import type { SystemFeatures } from '@/types/feature'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSystemFeatures, InstallationScope } from '@/types/feature'

// ==================== Imports (after mocks) ====================

import Empty from './index'

// ==================== Mock Setup ====================

// Use vi.hoisted to define ALL mock state and functions
const {
  mockSetActiveTab,
  mockUseInstalledPluginList,
  mockState,
  stableT,
} = vi.hoisted(() => {
  const state = {
    filters: {
      categories: [] as string[],
      tags: [] as string[],
      searchQuery: '',
    } as FilterState,
    systemFeatures: {
      enable_marketplace: true,
      plugin_installation_permission: {
        plugin_installation_scope: 'all' as const,
        restrict_to_marketplace_only: false,
      },
    } as Partial<SystemFeatures>,
    pluginList: { plugins: [] as Array<{ id: string }> } as { plugins: Array<{ id: string }> } | undefined,
  }
  // Stable t function to prevent infinite re-renders
  // The component's useEffect and useMemo depend on t
  const t = (key: string) => key
  return {
    mockSetActiveTab: vi.fn(),
    mockUseInstalledPluginList: vi.fn(() => ({ data: state.pluginList })),
    mockState: state,
    stableT: t,
  }
})

// Mock plugin page context
vi.mock('../context', () => ({
  usePluginPageContext: (selector: (value: any) => any) => {
    const contextValue = {
      filters: mockState.filters,
      setActiveTab: mockSetActiveTab,
    }
    return selector(contextValue)
  },
}))

// Mock global public store (Zustand store)
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: any) => any) => {
    return selector({
      systemFeatures: {
        ...defaultSystemFeatures,
        ...mockState.systemFeatures,
      },
    })
  },
}))

// Mock useInstalledPluginList hook
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => mockUseInstalledPluginList(),
}))

// Mock InstallFromGitHub component
vi.mock('@/app/components/plugins/install-plugin/install-from-github', () => ({
  default: ({ onClose }: { onSuccess: () => void, onClose: () => void }) => (
    <div data-testid="install-from-github-modal">
      <button data-testid="github-modal-close" onClick={onClose}>Close</button>
      <button data-testid="github-modal-success">Success</button>
    </div>
  ),
}))

// Mock InstallFromLocalPackage component
vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file, onClose }: { file: File, onSuccess: () => void, onClose: () => void }) => (
    <div data-testid="install-from-local-modal" data-file-name={file.name}>
      <button data-testid="local-modal-close" onClick={onClose}>Close</button>
      <button data-testid="local-modal-success">Success</button>
    </div>
  ),
}))

// Mock Line component
vi.mock('../../marketplace/empty/line', () => ({
  default: ({ className }: { className?: string }) => <div data-testid="line-component" className={className} />,
}))

// Override react-i18next with stable t function reference to prevent infinite re-renders
// The component's useEffect and useMemo depend on t, so it MUST be stable
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}))

// ==================== Test Utilities ====================

const resetMockState = () => {
  mockState.filters = { categories: [], tags: [], searchQuery: '' }
  mockState.systemFeatures = {
    enable_marketplace: true,
    plugin_installation_permission: {
      plugin_installation_scope: InstallationScope.ALL,
      restrict_to_marketplace_only: false,
    },
  }
  mockState.pluginList = { plugins: [] }
  mockUseInstalledPluginList.mockReturnValue({ data: mockState.pluginList })
}

const setMockFilters = (filters: Partial<FilterState>) => {
  mockState.filters = { ...mockState.filters, ...filters }
}

const setMockSystemFeatures = (features: Partial<SystemFeatures>) => {
  mockState.systemFeatures = { ...mockState.systemFeatures, ...features }
}

const setMockPluginList = (list: { plugins: Array<{ id: string }> } | undefined) => {
  mockState.pluginList = list
  mockUseInstalledPluginList.mockReturnValue({ data: list })
}

const createMockFile = (name: string, type = 'application/octet-stream'): File => {
  return new File(['test'], name, { type })
}

// Helper to wait for useEffect to complete (single tick)
const flushEffects = async () => {
  await act(async () => {})
}

// ==================== Tests ====================

describe('Empty Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockState()
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render basic structure correctly', async () => {
      // Arrange & Act
      const { container } = render(<Empty />)
      await flushEffects()

      // Assert - file input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeInTheDocument()
      expect(fileInput.style.display).toBe('none')
      expect(fileInput.accept).toBe('.difypkg,.difybndl')

      // Assert - skeleton cards (20 in the grid + 1 icon container)
      const skeletonCards = container.querySelectorAll('.rounded-xl.bg-components-card-bg')
      expect(skeletonCards.length).toBeGreaterThanOrEqual(20)

      // Assert - group icon container
      const iconContainer = document.querySelector('.size-14')
      expect(iconContainer).toBeInTheDocument()

      // Assert - line components
      const lines = screen.getAllByTestId('line-component')
      expect(lines).toHaveLength(4)
    })
  })

  // ==================== Text Display Tests (useMemo) ====================
  describe('Text Display (useMemo)', () => {
    it('should display "noInstalled" text when plugin list is empty', async () => {
      // Arrange
      setMockPluginList({ plugins: [] })

      // Act
      render(<Empty />)
      await flushEffects()

      // Assert
      expect(screen.getByText('list.noInstalled')).toBeInTheDocument()
    })

    it('should display "notFound" text when filters are active with plugins', async () => {
      // Arrange
      setMockPluginList({ plugins: [{ id: 'plugin-1' }] })

      // Test categories filter
      setMockFilters({ categories: ['model'] })
      const { rerender } = render(<Empty />)
      await flushEffects()
      expect(screen.getByText('list.notFound')).toBeInTheDocument()

      // Test tags filter
      setMockFilters({ categories: [], tags: ['tag1'] })
      rerender(<Empty />)
      await flushEffects()
      expect(screen.getByText('list.notFound')).toBeInTheDocument()

      // Test searchQuery filter
      setMockFilters({ tags: [], searchQuery: 'test query' })
      rerender(<Empty />)
      await flushEffects()
      expect(screen.getByText('list.notFound')).toBeInTheDocument()
    })

    it('should prioritize "noInstalled" over "notFound" when no plugins exist', async () => {
      // Arrange
      setMockFilters({ categories: ['model'], searchQuery: 'test' })
      setMockPluginList({ plugins: [] })

      // Act
      render(<Empty />)
      await flushEffects()

      // Assert
      expect(screen.getByText('list.noInstalled')).toBeInTheDocument()
    })
  })

  // ==================== Install Methods Tests (useEffect) ====================
  describe('Install Methods (useEffect)', () => {
    it('should render all three install methods when marketplace enabled and not restricted', async () => {
      // Arrange
      setMockSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: false,
        },
      })

      // Act
      render(<Empty />)
      await flushEffects()

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
      expect(screen.getByText('source.marketplace')).toBeInTheDocument()
      expect(screen.getByText('source.github')).toBeInTheDocument()
      expect(screen.getByText('source.local')).toBeInTheDocument()

      // Verify button order
      const buttonTexts = buttons.map(btn => btn.textContent)
      expect(buttonTexts[0]).toContain('source.marketplace')
      expect(buttonTexts[1]).toContain('source.github')
      expect(buttonTexts[2]).toContain('source.local')
    })

    it('should render only marketplace method when restricted to marketplace only', async () => {
      // Arrange
      setMockSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: true,
        },
      })

      // Act
      render(<Empty />)
      await flushEffects()

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(1)
      expect(screen.getByText('source.marketplace')).toBeInTheDocument()
      expect(screen.queryByText('source.github')).not.toBeInTheDocument()
      expect(screen.queryByText('source.local')).not.toBeInTheDocument()
    })

    it('should render github and local methods when marketplace is disabled', async () => {
      // Arrange
      setMockSystemFeatures({
        enable_marketplace: false,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: false,
        },
      })

      // Act
      render(<Empty />)
      await flushEffects()

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
      expect(screen.queryByText('source.marketplace')).not.toBeInTheDocument()
      expect(screen.getByText('source.github')).toBeInTheDocument()
      expect(screen.getByText('source.local')).toBeInTheDocument()
    })

    it('should render no methods when marketplace disabled and restricted', async () => {
      // Arrange
      setMockSystemFeatures({
        enable_marketplace: false,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: true,
        },
      })

      // Act
      render(<Empty />)
      await flushEffects()

      // Assert
      const buttons = screen.queryAllByRole('button')
      expect(buttons).toHaveLength(0)
    })
  })

  // ==================== User Interactions Tests ====================
  describe('User Interactions', () => {
    it('should call setActiveTab with "discover" when marketplace button is clicked', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()

      // Act
      fireEvent.click(screen.getByText('source.marketplace'))

      // Assert
      expect(mockSetActiveTab).toHaveBeenCalledWith('discover')
    })

    it('should open and close GitHub modal correctly', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()

      // Assert - initially no modal
      expect(screen.queryByTestId('install-from-github-modal')).not.toBeInTheDocument()

      // Act - open modal
      fireEvent.click(screen.getByText('source.github'))

      // Assert - modal is open
      expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()

      // Act - close modal
      fireEvent.click(screen.getByTestId('github-modal-close'))

      // Assert - modal is closed
      expect(screen.queryByTestId('install-from-github-modal')).not.toBeInTheDocument()
    })

    it('should trigger file input click when local button is clicked', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      // Act
      fireEvent.click(screen.getByText('source.local'))

      // Assert
      expect(clickSpy).toHaveBeenCalled()
    })

    it('should open and close local modal when file is selected', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const mockFile = createMockFile('test-plugin.difypkg')

      // Assert - initially no modal
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()

      // Act - select file
      Object.defineProperty(fileInput, 'files', { value: [mockFile], writable: true })
      fireEvent.change(fileInput)

      // Assert - modal is open with correct file
      expect(screen.getByTestId('install-from-local-modal')).toBeInTheDocument()
      expect(screen.getByTestId('install-from-local-modal')).toHaveAttribute('data-file-name', 'test-plugin.difypkg')

      // Act - close modal
      fireEvent.click(screen.getByTestId('local-modal-close'))

      // Assert - modal is closed
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
    })

    it('should not open local modal when no file is selected', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Act - trigger change with empty files
      Object.defineProperty(fileInput, 'files', { value: [], writable: true })
      fireEvent.change(fileInput)

      // Assert
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
    })
  })

  // ==================== State Management Tests ====================
  describe('State Management', () => {
    it('should maintain modal state correctly and allow reopening', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()

      // Act - Open, close, and reopen GitHub modal
      fireEvent.click(screen.getByText('source.github'))
      expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('github-modal-close'))
      expect(screen.queryByTestId('install-from-github-modal')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('source.github'))
      expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()
    })

    it('should update selectedFile state when file is selected', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Act - select .difypkg file
      Object.defineProperty(fileInput, 'files', { value: [createMockFile('my-plugin.difypkg')], writable: true })
      fireEvent.change(fileInput)
      expect(screen.getByTestId('install-from-local-modal')).toHaveAttribute('data-file-name', 'my-plugin.difypkg')

      // Close and select .difybndl file
      fireEvent.click(screen.getByTestId('local-modal-close'))
      Object.defineProperty(fileInput, 'files', { value: [createMockFile('test-bundle.difybndl')], writable: true })
      fireEvent.change(fileInput)
      expect(screen.getByTestId('install-from-local-modal')).toHaveAttribute('data-file-name', 'test-bundle.difybndl')
    })
  })

  // ==================== Side Effects Tests ====================
  describe('Side Effects', () => {
    it('should render correct install methods based on system features', async () => {
      // Test 1: All methods when marketplace enabled and not restricted
      setMockSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: false,
        },
      })

      const { unmount: unmount1 } = render(<Empty />)
      await flushEffects()
      expect(screen.getAllByRole('button')).toHaveLength(3)
      unmount1()

      // Test 2: Only marketplace when restricted
      setMockSystemFeatures({
        enable_marketplace: true,
        plugin_installation_permission: {
          plugin_installation_scope: InstallationScope.ALL,
          restrict_to_marketplace_only: true,
        },
      })

      render(<Empty />)
      await flushEffects()
      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(screen.getByText('source.marketplace')).toBeInTheDocument()
    })

    it('should render correct text based on plugin list and filters', async () => {
      // Test 1: noInstalled when plugin list is empty
      setMockPluginList({ plugins: [] })
      setMockFilters({ categories: [], tags: [], searchQuery: '' })

      const { unmount: unmount1 } = render(<Empty />)
      await flushEffects()
      expect(screen.getByText('list.noInstalled')).toBeInTheDocument()
      unmount1()

      // Test 2: notFound when filters are active with plugins
      setMockFilters({ categories: ['tool'] })
      setMockPluginList({ plugins: [{ id: 'plugin-1' }] })

      render(<Empty />)
      await flushEffects()
      expect(screen.getByText('list.notFound')).toBeInTheDocument()
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle undefined plugin data gracefully', () => {
      // Test undefined plugin list - component should render without error
      setMockPluginList(undefined)
      expect(() => render(<Empty />)).not.toThrow()
    })

    it('should handle file input edge cases', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Test undefined files
      Object.defineProperty(fileInput, 'files', { value: undefined, writable: true })
      fireEvent.change(fileInput)
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
    })
  })

  // ==================== React.memo Tests ====================
  describe('React.memo Behavior', () => {
    it('should be wrapped with React.memo and have displayName', () => {
      // Assert
      expect(Empty).toBeDefined()
      expect((Empty as any).$$typeof?.toString()).toContain('Symbol')
      expect((Empty as any).displayName || (Empty as any).type?.displayName).toBeDefined()
    })
  })

  // ==================== Modal Callbacks Tests ====================
  describe('Modal Callbacks', () => {
    it('should handle modal onSuccess callbacks (noop)', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()

      // Test GitHub modal onSuccess
      fireEvent.click(screen.getByText('source.github'))
      fireEvent.click(screen.getByTestId('github-modal-success'))
      expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()

      // Close GitHub modal and test Local modal onSuccess
      fireEvent.click(screen.getByTestId('github-modal-close'))

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', { value: [createMockFile('test-plugin.difypkg')], writable: true })
      fireEvent.change(fileInput)

      fireEvent.click(screen.getByTestId('local-modal-success'))
      expect(screen.getByTestId('install-from-local-modal')).toBeInTheDocument()
    })
  })

  // ==================== Conditional Modal Rendering ====================
  describe('Conditional Modal Rendering', () => {
    it('should only render one modal at a time and require file for local modal', async () => {
      // Arrange
      render(<Empty />)
      await flushEffects()

      // Assert - no modals initially
      expect(screen.queryByTestId('install-from-github-modal')).not.toBeInTheDocument()
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()

      // Open GitHub modal - only GitHub modal visible
      fireEvent.click(screen.getByText('source.github'))
      expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()

      // Click local button - triggers file input, no modal yet (no file selected)
      fireEvent.click(screen.getByText('source.local'))
      // GitHub modal should still be visible, local modal requires file selection
      expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
    })
  })
})
