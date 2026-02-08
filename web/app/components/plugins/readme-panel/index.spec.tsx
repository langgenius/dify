import type { PluginDetail } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '../types'
import { BUILTIN_TOOLS_ARRAY } from './constants'
import { ReadmeEntrance } from './entrance'
import ReadmePanel from './index'
import { ReadmeShowType, useReadmePanelStore } from './store'

// ================================
// Mock external dependencies only
// ================================

// Mock usePluginReadme hook
const mockUsePluginReadme = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  usePluginReadme: (params: { plugin_unique_identifier: string, language?: string }) => mockUsePluginReadme(params),
}))

// Mock useLanguage hook
let mockLanguage = 'en-US'
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => mockLanguage,
}))

// Mock DetailHeader component (complex component with many dependencies)
vi.mock('../plugin-detail-panel/detail-header', () => ({
  default: ({ detail, isReadmeView }: { detail: PluginDetail, isReadmeView: boolean }) => (
    <div data-testid="detail-header" data-is-readme-view={isReadmeView}>
      {detail.name}
    </div>
  ),
}))

// ================================
// Test Data Factories
// ================================

const createMockPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-plugin-id',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  name: 'test-plugin',
  plugin_id: 'test-plugin-id',
  plugin_unique_identifier: 'test-plugin@1.0.0',
  declaration: {
    plugin_unique_identifier: 'test-plugin@1.0.0',
    version: '1.0.0',
    author: 'test-author',
    icon: 'test-icon.png',
    name: 'test-plugin',
    category: PluginCategoryEnum.tool,
    label: { 'en-US': 'Test Plugin' } as Record<string, string>,
    description: { 'en-US': 'Test plugin description' } as Record<string, string>,
    created_at: '2024-01-01T00:00:00Z',
    resource: null,
    plugins: null,
    verified: true,
    endpoint: { settings: [], endpoints: [] },
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: {
      events: [],
      identity: {
        author: 'test-author',
        name: 'test-plugin',
        label: { 'en-US': 'Test Plugin' } as Record<string, string>,
        description: { 'en-US': 'Test plugin description' } as Record<string, string>,
        icon: 'test-icon.png',
        tags: [],
      },
      subscription_constructor: {
        credentials_schema: [],
        oauth_schema: { client_schema: [], credentials_schema: [] },
        parameters: [],
      },
      subscription_schema: [],
    },
  },
  installation_id: 'install-123',
  tenant_id: 'tenant-123',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-plugin@1.0.0',
  source: PluginSource.marketplace,
  status: 'active' as const,
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

// ================================
// Test Utilities
// ================================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

// ================================
// Constants Tests
// ================================
describe('BUILTIN_TOOLS_ARRAY', () => {
  it('should contain expected builtin tools', () => {
    expect(BUILTIN_TOOLS_ARRAY).toContain('code')
    expect(BUILTIN_TOOLS_ARRAY).toContain('audio')
    expect(BUILTIN_TOOLS_ARRAY).toContain('time')
    expect(BUILTIN_TOOLS_ARRAY).toContain('webscraper')
  })

  it('should have exactly 4 builtin tools', () => {
    expect(BUILTIN_TOOLS_ARRAY).toHaveLength(4)
  })
})

// ================================
// Store Tests
// ================================
describe('useReadmePanelStore', () => {
  describe('Initial State', () => {
    it('should have undefined currentPluginDetail initially', () => {
      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toBeUndefined()
    })
  })

  describe('setCurrentPluginDetail', () => {
    it('should set currentPluginDetail with detail and default showType', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      act(() => {
        setCurrentPluginDetail(mockDetail)
      })

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toEqual({
        detail: mockDetail,
        showType: ReadmeShowType.drawer,
      })
    })

    it('should set currentPluginDetail with custom showType', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      act(() => {
        setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)
      })

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toEqual({
        detail: mockDetail,
        showType: ReadmeShowType.modal,
      })
    })

    it('should clear currentPluginDetail when called without arguments', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      // First set a detail
      act(() => {
        setCurrentPluginDetail(mockDetail)
      })

      // Then clear it
      act(() => {
        setCurrentPluginDetail()
      })

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toBeUndefined()
    })

    it('should clear currentPluginDetail when called with undefined', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      // First set a detail
      act(() => {
        setCurrentPluginDetail(mockDetail)
      })

      // Then clear it with explicit undefined
      act(() => {
        setCurrentPluginDetail(undefined)
      })

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toBeUndefined()
    })
  })

  describe('ReadmeShowType enum', () => {
    it('should have drawer and modal types', () => {
      expect(ReadmeShowType.drawer).toBe('drawer')
      expect(ReadmeShowType.modal).toBe('modal')
    })
  })
})

// ================================
// ReadmeEntrance Component Tests
// ================================
describe('ReadmeEntrance', () => {
  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render the entrance button with full tip text', () => {
      const mockDetail = createMockPluginDetail()

      render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText('plugin.readmeInfo.needHelpCheckReadme')).toBeInTheDocument()
    })

    it('should render with short tip text when showShortTip is true', () => {
      const mockDetail = createMockPluginDetail()

      render(<ReadmeEntrance pluginDetail={mockDetail} showShortTip />)

      expect(screen.getByText('plugin.readmeInfo.title')).toBeInTheDocument()
    })

    it('should render divider when showShortTip is false', () => {
      const mockDetail = createMockPluginDetail()

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} showShortTip={false} />)

      expect(container.querySelector('.bg-divider-regular')).toBeInTheDocument()
    })

    it('should not render divider when showShortTip is true', () => {
      const mockDetail = createMockPluginDetail()

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} showShortTip />)

      expect(container.querySelector('.bg-divider-regular')).not.toBeInTheDocument()
    })

    it('should apply drawer mode padding class', () => {
      const mockDetail = createMockPluginDetail()

      const { container } = render(
        <ReadmeEntrance pluginDetail={mockDetail} showType={ReadmeShowType.drawer} />,
      )

      expect(container.querySelector('.px-4')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const mockDetail = createMockPluginDetail()

      const { container } = render(
        <ReadmeEntrance pluginDetail={mockDetail} className="custom-class" />,
      )

      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })
  })

  // ================================
  // Conditional Rendering / Edge Cases
  // ================================
  describe('Conditional Rendering', () => {
    it('should return null when pluginDetail is null/undefined', () => {
      const { container } = render(<ReadmeEntrance pluginDetail={null as unknown as PluginDetail} />)

      expect(container.firstChild).toBeNull()
    })

    it('should return null when plugin_unique_identifier is missing', () => {
      const mockDetail = createMockPluginDetail({ plugin_unique_identifier: '' })

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(container.firstChild).toBeNull()
    })

    it('should return null for builtin tool: code', () => {
      const mockDetail = createMockPluginDetail({ id: 'code' })

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(container.firstChild).toBeNull()
    })

    it('should return null for builtin tool: audio', () => {
      const mockDetail = createMockPluginDetail({ id: 'audio' })

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(container.firstChild).toBeNull()
    })

    it('should return null for builtin tool: time', () => {
      const mockDetail = createMockPluginDetail({ id: 'time' })

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(container.firstChild).toBeNull()
    })

    it('should return null for builtin tool: webscraper', () => {
      const mockDetail = createMockPluginDetail({ id: 'webscraper' })

      const { container } = render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(container.firstChild).toBeNull()
    })

    it('should render for non-builtin plugins', () => {
      const mockDetail = createMockPluginDetail({ id: 'custom-plugin' })

      render(<ReadmeEntrance pluginDetail={mockDetail} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions / Event Handlers
  // ================================
  describe('User Interactions', () => {
    it('should call setCurrentPluginDetail with drawer type when clicked', () => {
      const mockDetail = createMockPluginDetail()

      render(<ReadmeEntrance pluginDetail={mockDetail} />)

      fireEvent.click(screen.getByRole('button'))

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toEqual({
        detail: mockDetail,
        showType: ReadmeShowType.drawer,
      })
    })

    it('should call setCurrentPluginDetail with modal type when clicked', () => {
      const mockDetail = createMockPluginDetail()

      render(<ReadmeEntrance pluginDetail={mockDetail} showType={ReadmeShowType.modal} />)

      fireEvent.click(screen.getByRole('button'))

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toEqual({
        detail: mockDetail,
        showType: ReadmeShowType.modal,
      })
    })
  })

  // ================================
  // Prop Variations
  // ================================
  describe('Prop Variations', () => {
    it('should use default showType when not provided', () => {
      const mockDetail = createMockPluginDetail()

      render(<ReadmeEntrance pluginDetail={mockDetail} />)

      fireEvent.click(screen.getByRole('button'))

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail?.showType).toBe(ReadmeShowType.drawer)
    })

    it('should handle modal showType correctly', () => {
      const mockDetail = createMockPluginDetail()

      render(<ReadmeEntrance pluginDetail={mockDetail} showType={ReadmeShowType.modal} />)

      // Modal mode should not have px-4 class
      const container = screen.getByRole('button').parentElement
      expect(container).not.toHaveClass('px-4')
    })
  })
})

// ================================
// ReadmePanel Component Tests
// ================================
describe('ReadmePanel', () => {
  beforeEach(() => {
    mockUsePluginReadme.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should return null when no plugin detail is set', () => {
      const { container } = renderWithQueryClient(<ReadmePanel />)

      expect(container.firstChild).toBeNull()
    })

    it('should render portal content when plugin detail is set', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(screen.getByText('plugin.readmeInfo.title')).toBeInTheDocument()
    })

    it('should render DetailHeader component', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(screen.getByTestId('detail-header')).toBeInTheDocument()
      expect(screen.getByTestId('detail-header')).toHaveAttribute('data-is-readme-view', 'true')
    })

    it('should render close button', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // ActionButton wraps the close icon
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // ================================
  // Loading State Tests
  // ================================
  describe('Loading State', () => {
    it('should show loading indicator when isLoading is true', () => {
      mockUsePluginReadme.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Loading component should be rendered with role="status"
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  // ================================
  // Error State Tests
  // ================================
  describe('Error State', () => {
    it('should show error message when error occurs', () => {
      mockUsePluginReadme.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Failed to fetch'),
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(screen.getByText('plugin.readmeInfo.failedToFetch')).toBeInTheDocument()
    })
  })

  // ================================
  // No Readme Available State Tests
  // ================================
  describe('No Readme Available', () => {
    it('should show no readme message when readme is empty', () => {
      mockUsePluginReadme.mockReturnValue({
        data: { readme: '' },
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(screen.getByText('plugin.readmeInfo.noReadmeAvailable')).toBeInTheDocument()
    })

    it('should show no readme message when data is null', () => {
      mockUsePluginReadme.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(screen.getByText('plugin.readmeInfo.noReadmeAvailable')).toBeInTheDocument()
    })
  })

  // ================================
  // Markdown Content Tests
  // ================================
  describe('Markdown Content', () => {
    it('should render markdown container when readme is available', () => {
      mockUsePluginReadme.mockReturnValue({
        data: { readme: '# Test Readme Content' },
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Markdown component container should be rendered
      // Note: The Markdown component uses dynamic import, so content may load asynchronously
      const markdownContainer = document.querySelector('.markdown-body')
      expect(markdownContainer).toBeInTheDocument()
    })

    it('should not show error or no-readme message when readme is available', () => {
      mockUsePluginReadme.mockReturnValue({
        data: { readme: '# Test Readme Content' },
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Should not show error or no-readme message
      expect(screen.queryByText('plugin.readmeInfo.failedToFetch')).not.toBeInTheDocument()
      expect(screen.queryByText('plugin.readmeInfo.noReadmeAvailable')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Portal Rendering Tests (Drawer Mode)
  // ================================
  describe('Portal Rendering - Drawer Mode', () => {
    it('should render drawer styled container in drawer mode', () => {
      mockUsePluginReadme.mockReturnValue({
        data: { readme: '# Test' },
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Drawer mode has specific max-width
      const drawerContainer = document.querySelector('.max-w-\\[600px\\]')
      expect(drawerContainer).toBeInTheDocument()
    })

    it('should have correct drawer positioning classes', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Check for drawer-specific classes
      const backdrop = document.querySelector('.justify-start')
      expect(backdrop).toBeInTheDocument()
    })
  })

  // ================================
  // Portal Rendering Tests (Modal Mode)
  // ================================
  describe('Portal Rendering - Modal Mode', () => {
    it('should render modal styled container in modal mode', () => {
      mockUsePluginReadme.mockReturnValue({
        data: { readme: '# Test' },
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)

      renderWithQueryClient(<ReadmePanel />)

      // Modal mode has different max-width
      const modalContainer = document.querySelector('.max-w-\\[800px\\]')
      expect(modalContainer).toBeInTheDocument()
    })

    it('should have correct modal positioning classes', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)

      renderWithQueryClient(<ReadmePanel />)

      // Check for modal-specific classes
      const backdrop = document.querySelector('.items-center.justify-center')
      expect(backdrop).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions / Event Handlers
  // ================================
  describe('User Interactions', () => {
    it('should close panel when close button is clicked', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      fireEvent.click(screen.getByRole('button'))

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toBeUndefined()
    })

    it('should close panel when backdrop is clicked', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Click on the backdrop (outer div)
      const backdrop = document.querySelector('.fixed.inset-0')
      fireEvent.click(backdrop!)

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toBeUndefined()
    })

    it('should not close panel when content area is clicked', async () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // Click on the content container (should stop propagation)
      const contentContainer = document.querySelector('.pointer-events-auto')
      fireEvent.click(contentContainer!)

      await waitFor(() => {
        const { currentPluginDetail } = useReadmePanelStore.getState()
        expect(currentPluginDetail).toBeDefined()
      })
    })

    it('should not close panel when content area is clicked in modal mode', async () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)

      renderWithQueryClient(<ReadmePanel />)

      // Click on the content container in modal mode (should stop propagation)
      const contentContainer = document.querySelector('.pointer-events-auto')
      fireEvent.click(contentContainer!)

      await waitFor(() => {
        const { currentPluginDetail } = useReadmePanelStore.getState()
        expect(currentPluginDetail).toBeDefined()
      })
    })
  })

  // ================================
  // API Call Tests
  // ================================
  describe('API Calls', () => {
    it('should call usePluginReadme with correct parameters', () => {
      const mockDetail = createMockPluginDetail({
        plugin_unique_identifier: 'custom-plugin@2.0.0',
      })
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(mockUsePluginReadme).toHaveBeenCalledWith({
        plugin_unique_identifier: 'custom-plugin@2.0.0',
        language: 'en-US',
      })
    })

    it('should pass undefined language for zh-Hans locale', () => {
      // Set language to zh-Hans
      mockLanguage = 'zh-Hans'

      const mockDetail = createMockPluginDetail({
        plugin_unique_identifier: 'zh-plugin@1.0.0',
      })
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      // The component should pass undefined for language when zh-Hans
      expect(mockUsePluginReadme).toHaveBeenCalledWith({
        plugin_unique_identifier: 'zh-plugin@1.0.0',
        language: undefined,
      })

      // Reset language
      mockLanguage = 'en-US'
    })

    it('should handle empty plugin_unique_identifier', () => {
      mockUsePluginReadme.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      })

      const mockDetail = createMockPluginDetail({
        plugin_unique_identifier: '',
      })
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(mockUsePluginReadme).toHaveBeenCalledWith({
        plugin_unique_identifier: '',
        language: 'en-US',
      })
    })
  })

  // ================================
  // Edge Cases
  // ================================
  describe('Edge Cases', () => {
    it('should handle detail with missing declaration', () => {
      const mockDetail = createMockPluginDetail()
      // Simulate missing fields
      delete (mockDetail as Partial<PluginDetail>).declaration

      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      // This should not throw
      expect(() => setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)).not.toThrow()
    })

    it('should handle rapid open/close operations', async () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      // Rapidly toggle the panel
      act(() => {
        setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)
        setCurrentPluginDetail()
        setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)
      })

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail?.showType).toBe(ReadmeShowType.modal)
    })

    it('should handle switching between drawer and modal modes', () => {
      const mockDetail = createMockPluginDetail()
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      // Start with drawer
      act(() => {
        setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)
      })

      let state = useReadmePanelStore.getState()
      expect(state.currentPluginDetail?.showType).toBe(ReadmeShowType.drawer)

      // Switch to modal
      act(() => {
        setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)
      })

      state = useReadmePanelStore.getState()
      expect(state.currentPluginDetail?.showType).toBe(ReadmeShowType.modal)
    })

    it('should handle undefined detail gracefully', () => {
      const { setCurrentPluginDetail } = useReadmePanelStore.getState()

      // Set to undefined explicitly
      act(() => {
        setCurrentPluginDetail(undefined, ReadmeShowType.drawer)
      })

      const { currentPluginDetail } = useReadmePanelStore.getState()
      expect(currentPluginDetail).toBeUndefined()
    })
  })

  // ================================
  // Integration Tests
  // ================================
  describe('Integration', () => {
    it('should work correctly when opened from ReadmeEntrance', () => {
      const mockDetail = createMockPluginDetail()

      mockUsePluginReadme.mockReturnValue({
        data: { readme: '# Integration Test' },
        isLoading: false,
        error: null,
      })

      // Render both components
      const { rerender } = renderWithQueryClient(
        <>
          <ReadmeEntrance pluginDetail={mockDetail} />
          <ReadmePanel />
        </>,
      )

      // Initially panel should not show content
      expect(screen.queryByTestId('detail-header')).not.toBeInTheDocument()

      // Click the entrance button
      fireEvent.click(screen.getByRole('button'))

      // Re-render to pick up store changes
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <ReadmeEntrance pluginDetail={mockDetail} />
          <ReadmePanel />
        </QueryClientProvider>,
      )

      // Panel should now show content
      expect(screen.getByTestId('detail-header')).toBeInTheDocument()
      // Markdown content renders in a container (dynamic import may not render content synchronously)
      expect(document.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('should display correct plugin information in header', () => {
      const mockDetail = createMockPluginDetail({
        name: 'my-awesome-plugin',
      })

      const { setCurrentPluginDetail } = useReadmePanelStore.getState()
      setCurrentPluginDetail(mockDetail, ReadmeShowType.drawer)

      renderWithQueryClient(<ReadmePanel />)

      expect(screen.getByText('my-awesome-plugin')).toBeInTheDocument()
    })
  })
})
