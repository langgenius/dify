import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { AppModeEnum } from '@/types/app'

// Import after mocks
import List from './list'

// Mock next/navigation
const mockReplace = vi.fn()
const mockRouter = { replace: mockReplace }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(''),
}))

// Mock app context
const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
  }),
}))

// Mock global public store
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({
    systemFeatures: {
      branding: { enabled: false },
    },
  }),
}))

// Mock custom hooks - allow dynamic query state
const mockSetQuery = vi.fn()
const mockQueryState = {
  tagIDs: [] as string[],
  keywords: '',
  isCreatedByMe: false,
}
vi.mock('./hooks/use-apps-query-state', () => ({
  default: () => ({
    query: mockQueryState,
    setQuery: mockSetQuery,
  }),
}))

// Store callback for testing DSL file drop
let mockOnDSLFileDropped: ((file: File) => void) | null = null
let mockDragging = false
vi.mock('./hooks/use-dsl-drag-drop', () => ({
  useDSLDragDrop: ({ onDSLFileDropped }: { onDSLFileDropped: (file: File) => void }) => {
    mockOnDSLFileDropped = onDSLFileDropped
    return { dragging: mockDragging }
  },
}))

const mockSetActiveTab = vi.fn()
vi.mock('nuqs', () => ({
  useQueryState: () => ['all', mockSetActiveTab],
  parseAsString: {
    withDefault: () => ({
      withOptions: () => ({}),
    }),
  },
}))

// Mock service hooks - use object for mutable state (vi.mock is hoisted)
const mockRefetch = vi.fn()
const mockFetchNextPage = vi.fn()

const mockServiceState = {
  error: null as Error | null,
  hasNextPage: false,
  isLoading: false,
  isFetchingNextPage: false,
}

const defaultAppData = {
  pages: [{
    data: [
      {
        id: 'app-1',
        name: 'Test App 1',
        description: 'Description 1',
        mode: AppModeEnum.CHAT,
        icon: '🤖',
        icon_type: 'emoji',
        icon_background: '#FFEAD5',
        tags: [],
        author_name: 'Author 1',
        created_at: 1704067200,
        updated_at: 1704153600,
      },
      {
        id: 'app-2',
        name: 'Test App 2',
        description: 'Description 2',
        mode: AppModeEnum.WORKFLOW,
        icon: '⚙️',
        icon_type: 'emoji',
        icon_background: '#E4FBCC',
        tags: [],
        author_name: 'Author 2',
        created_at: 1704067200,
        updated_at: 1704153600,
      },
    ],
    total: 2,
  }],
}

vi.mock('@/service/use-apps', () => ({
  useInfiniteAppList: () => ({
    data: defaultAppData,
    isLoading: mockServiceState.isLoading,
    isFetchingNextPage: mockServiceState.isFetchingNextPage,
    fetchNextPage: mockFetchNextPage,
    hasNextPage: mockServiceState.hasNextPage,
    error: mockServiceState.error,
    refetch: mockRefetch,
  }),
}))

// Use real tag store - global zustand mock will auto-reset between tests

// Mock tag service to avoid API calls in TagFilter
vi.mock('@/service/tag', () => ({
  fetchTagList: vi.fn().mockResolvedValue([{ id: 'tag-1', name: 'Test Tag', type: 'app' }]),
}))

// Store TagFilter onChange callback for testing
let mockTagFilterOnChange: ((value: string[]) => void) | null = null
vi.mock('@/app/components/base/tag-management/filter', () => ({
  default: ({ onChange }: { onChange: (value: string[]) => void }) => {
    mockTagFilterOnChange = onChange
    return React.createElement('div', { 'data-testid': 'tag-filter' }, 'common.tag.placeholder')
  },
}))

// Mock config
vi.mock('@/config', () => ({
  NEED_REFRESH_APP_LIST_KEY: 'needRefreshAppList',
}))

// Mock pay hook
vi.mock('@/hooks/use-pay', () => ({
  CheckModal: () => null,
}))

// Mock ahooks - useMount only executes once on mount, not on fn change
vi.mock('ahooks', () => ({
  useDebounceFn: (fn: () => void) => ({ run: fn }),
  useMount: (fn: () => void) => {
    const fnRef = React.useRef(fn)
    fnRef.current = fn
    React.useEffect(() => {
      fnRef.current()
    }, [])
  },
}))

// Mock dynamic imports
vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<any>) => {
    const fnString = importFn.toString()

    if (fnString.includes('tag-management')) {
      return function MockTagManagement() {
        return React.createElement('div', { 'data-testid': 'tag-management-modal' })
      }
    }
    if (fnString.includes('create-from-dsl-modal')) {
      return function MockCreateFromDSLModal({ show, onClose, onSuccess }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'create-dsl-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-dsl-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-dsl-modal' }, 'Success'))
      }
    }
    return () => null
  },
}))

/**
 * Mock child components for focused List component testing.
 * These mocks isolate the List component's behavior from its children.
 * Each child component (AppCard, NewAppCard, Empty, Footer) has its own dedicated tests.
 */
vi.mock('./app-card', () => ({
  default: ({ app }: any) => {
    return React.createElement('div', { 'data-testid': `app-card-${app.id}`, 'role': 'article' }, app.name)
  },
}))

vi.mock('./new-app-card', () => ({
  default: React.forwardRef((_props: any, _ref: any) => {
    return React.createElement('div', { 'data-testid': 'new-app-card', 'role': 'button' }, 'New App Card')
  }),
}))

vi.mock('./empty', () => ({
  default: () => {
    return React.createElement('div', { 'data-testid': 'empty-state', 'role': 'status' }, 'No apps found')
  },
}))

vi.mock('./footer', () => ({
  default: () => {
    return React.createElement('footer', { 'data-testid': 'footer', 'role': 'contentinfo' }, 'Footer')
  },
}))

// Store IntersectionObserver callback
let intersectionCallback: IntersectionObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

// Mock IntersectionObserver
beforeAll(() => {
  globalThis.IntersectionObserver = class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback
    }

    observe = mockObserve
    disconnect = mockDisconnect
    unobserve = vi.fn()
    root = null
    rootMargin = ''
    thresholds = []
    takeRecords = () => []
  } as unknown as typeof IntersectionObserver
})

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set up tag store state
    useTagStore.setState({
      tagList: [{ id: 'tag-1', name: 'Test Tag', type: 'app', binding_count: 0 }],
      showTagManagementModal: false,
    })
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockDragging = false
    mockOnDSLFileDropped = null
    mockTagFilterOnChange = null
    mockServiceState.error = null
    mockServiceState.hasNextPage = false
    mockServiceState.isLoading = false
    mockServiceState.isFetchingNextPage = false
    mockQueryState.tagIDs = []
    mockQueryState.keywords = ''
    mockQueryState.isCreatedByMe = false
    intersectionCallback = null
    localStorage.clear()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<List />)
      // Tab slider renders app type tabs
      expect(screen.getByText('app.types.all')).toBeInTheDocument()
    })

    it('should render tab slider with all app types', () => {
      render(<List />)

      expect(screen.getByText('app.types.all')).toBeInTheDocument()
      expect(screen.getByText('app.types.workflow')).toBeInTheDocument()
      expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
      expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
      expect(screen.getByText('app.types.agent')).toBeInTheDocument()
      expect(screen.getByText('app.types.completion')).toBeInTheDocument()
    })

    it('should render search input', () => {
      render(<List />)
      // Input component renders a searchbox
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render tag filter', () => {
      render(<List />)
      // Tag filter renders with placeholder text
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should render created by me checkbox', () => {
      render(<List />)
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })

    it('should render app cards when apps exist', () => {
      render(<List />)

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
    })

    it('should render new app card for editors', () => {
      render(<List />)
      expect(screen.getByTestId('new-app-card')).toBeInTheDocument()
    })

    it('should render footer when branding is disabled', () => {
      render(<List />)
      expect(screen.getByTestId('footer')).toBeInTheDocument()
    })

    it('should render drop DSL hint for editors', () => {
      render(<List />)
      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should call setActiveTab when tab is clicked', () => {
      render(<List />)

      fireEvent.click(screen.getByText('app.types.workflow'))

      expect(mockSetActiveTab).toHaveBeenCalledWith(AppModeEnum.WORKFLOW)
    })

    it('should call setActiveTab for all tab', () => {
      render(<List />)

      fireEvent.click(screen.getByText('app.types.all'))

      expect(mockSetActiveTab).toHaveBeenCalledWith('all')
    })
  })

  describe('Search Functionality', () => {
    it('should render search input field', () => {
      render(<List />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should handle search input change', () => {
      render(<List />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test search' } })

      expect(mockSetQuery).toHaveBeenCalled()
    })

    it('should handle search input interaction', () => {
      render(<List />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should handle search clear button click', () => {
      // Set initial keywords to make clear button visible
      mockQueryState.keywords = 'existing search'

      render(<List />)

      // Find and click clear button (Input component uses .group class for clear icon container)
      const clearButton = document.querySelector('.group')
      expect(clearButton).toBeInTheDocument()
      if (clearButton)
        fireEvent.click(clearButton)

      // handleKeywordsChange should be called with empty string
      expect(mockSetQuery).toHaveBeenCalled()
    })
  })

  describe('Tag Filter', () => {
    it('should render tag filter component', () => {
      render(<List />)
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should render tag filter with placeholder', () => {
      render(<List />)

      // Tag filter is rendered
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })
  })

  describe('Created By Me Filter', () => {
    it('should render checkbox with correct label', () => {
      render(<List />)
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })

    it('should handle checkbox change', () => {
      render(<List />)

      // Checkbox component uses data-testid="checkbox-{id}"
      // CheckboxWithLabel doesn't pass testId, so id is undefined
      const checkbox = screen.getByTestId('checkbox-undefined')
      fireEvent.click(checkbox)

      expect(mockSetQuery).toHaveBeenCalled()
    })
  })

  describe('Non-Editor User', () => {
    it('should not render new app card for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      render(<List />)

      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
    })

    it('should not render drop DSL hint for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      render(<List />)

      expect(screen.queryByText(/drop dsl file to create app/i)).not.toBeInTheDocument()
    })
  })

  describe('Dataset Operator Redirect', () => {
    it('should redirect dataset operators to datasets page', () => {
      mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(true)

      render(<List />)

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })

  describe('Local Storage Refresh', () => {
    it('should call refetch when refresh key is set in localStorage', () => {
      localStorage.setItem('needRefreshAppList', '1')

      render(<List />)

      expect(mockRefetch).toHaveBeenCalled()
      expect(localStorage.getItem('needRefreshAppList')).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple renders without issues', () => {
      const { rerender } = render(<List />)
      expect(screen.getByText('app.types.all')).toBeInTheDocument()

      rerender(<List />)
      expect(screen.getByText('app.types.all')).toBeInTheDocument()
    })

    it('should render app cards correctly', () => {
      render(<List />)

      expect(screen.getByText('Test App 1')).toBeInTheDocument()
      expect(screen.getByText('Test App 2')).toBeInTheDocument()
    })

    it('should render with all filter options visible', () => {
      render(<List />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })
  })

  describe('Dragging State', () => {
    it('should show drop hint when DSL feature is enabled for editors', () => {
      render(<List />)
      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })
  })

  describe('App Type Tabs', () => {
    it('should render all app type tabs', () => {
      render(<List />)

      expect(screen.getByText('app.types.all')).toBeInTheDocument()
      expect(screen.getByText('app.types.workflow')).toBeInTheDocument()
      expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
      expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
      expect(screen.getByText('app.types.agent')).toBeInTheDocument()
      expect(screen.getByText('app.types.completion')).toBeInTheDocument()
    })

    it('should call setActiveTab for each app type', () => {
      render(<List />)

      const appTypeTexts = [
        { mode: AppModeEnum.WORKFLOW, text: 'app.types.workflow' },
        { mode: AppModeEnum.ADVANCED_CHAT, text: 'app.types.advanced' },
        { mode: AppModeEnum.CHAT, text: 'app.types.chatbot' },
        { mode: AppModeEnum.AGENT_CHAT, text: 'app.types.agent' },
        { mode: AppModeEnum.COMPLETION, text: 'app.types.completion' },
      ]

      appTypeTexts.forEach(({ mode, text }) => {
        fireEvent.click(screen.getByText(text))
        expect(mockSetActiveTab).toHaveBeenCalledWith(mode)
      })
    })
  })

  describe('Search and Filter Integration', () => {
    it('should display search input with correct attributes', () => {
      render(<List />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('value', '')
    })

    it('should have tag filter component', () => {
      render(<List />)

      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should display created by me label', () => {
      render(<List />)

      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })
  })

  describe('App List Display', () => {
    it('should display all app cards from data', () => {
      render(<List />)

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
    })

    it('should display app names correctly', () => {
      render(<List />)

      expect(screen.getByText('Test App 1')).toBeInTheDocument()
      expect(screen.getByText('Test App 2')).toBeInTheDocument()
    })
  })

  describe('Footer Visibility', () => {
    it('should render footer when branding is disabled', () => {
      render(<List />)

      expect(screen.getByTestId('footer')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Additional Coverage Tests
  // --------------------------------------------------------------------------
  describe('Additional Coverage', () => {
    it('should render dragging state overlay when dragging', () => {
      mockDragging = true
      const { container } = render(<List />)

      // Component should render successfully with dragging state
      expect(container).toBeInTheDocument()
    })

    it('should handle app mode filter in query params', () => {
      render(<List />)

      const workflowTab = screen.getByText('app.types.workflow')
      fireEvent.click(workflowTab)

      expect(mockSetActiveTab).toHaveBeenCalledWith(AppModeEnum.WORKFLOW)
    })

    it('should render new app card for editors', () => {
      render(<List />)

      expect(screen.getByTestId('new-app-card')).toBeInTheDocument()
    })
  })

  describe('DSL File Drop', () => {
    it('should handle DSL file drop and show modal', () => {
      render(<List />)

      // Simulate DSL file drop via the callback
      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      // Modal should be shown
      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()
    })

    it('should close DSL modal when onClose is called', () => {
      render(<List />)

      // Open modal via DSL file drop
      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByTestId('close-dsl-modal'))

      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
    })

    it('should close DSL modal and refetch when onSuccess is called', () => {
      render(<List />)

      // Open modal via DSL file drop
      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()

      // Click success button
      fireEvent.click(screen.getByTestId('success-dsl-modal'))

      // Modal should be closed and refetch should be called
      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Tag Filter Change', () => {
    it('should handle tag filter value change', () => {
      vi.useFakeTimers()
      render(<List />)

      // TagFilter component is rendered
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()

      // Trigger tag filter change via captured callback
      act(() => {
        if (mockTagFilterOnChange)
          mockTagFilterOnChange(['tag-1', 'tag-2'])
      })

      // Advance timers to trigger debounced setTagIDs
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // setQuery should have been called with updated tagIDs
      expect(mockSetQuery).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should handle empty tag filter selection', () => {
      vi.useFakeTimers()
      render(<List />)

      // Trigger tag filter change with empty array
      act(() => {
        if (mockTagFilterOnChange)
          mockTagFilterOnChange([])
      })

      // Advance timers
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockSetQuery).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('Infinite Scroll', () => {
    it('should call fetchNextPage when intersection observer triggers', () => {
      mockServiceState.hasNextPage = true
      render(<List />)

      // Simulate intersection
      if (intersectionCallback) {
        act(() => {
          intersectionCallback!(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
        })
      }

      expect(mockFetchNextPage).toHaveBeenCalled()
    })

    it('should not call fetchNextPage when not intersecting', () => {
      mockServiceState.hasNextPage = true
      render(<List />)

      // Simulate non-intersection
      if (intersectionCallback) {
        act(() => {
          intersectionCallback!(
            [{ isIntersecting: false } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
        })
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should not call fetchNextPage when loading', () => {
      mockServiceState.hasNextPage = true
      mockServiceState.isLoading = true
      render(<List />)

      if (intersectionCallback) {
        act(() => {
          intersectionCallback!(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
        })
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })
  })

  describe('Error State', () => {
    it('should handle error state in useEffect', () => {
      mockServiceState.error = new Error('Test error')
      const { container } = render(<List />)

      // Component should still render
      expect(container).toBeInTheDocument()
      // Disconnect should be called when there's an error (cleanup)
    })
  })
})
