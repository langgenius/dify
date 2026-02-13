import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import * as React from 'react'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { AppModeEnum } from '@/types/app'

import List from '../list'

const mockReplace = vi.fn()
const mockRouter = { replace: mockReplace }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(''),
}))

const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({
    systemFeatures: {
      branding: { enabled: false },
    },
  }),
}))

const mockSetQuery = vi.fn()
const mockQueryState = {
  tagIDs: [] as string[],
  keywords: '',
  isCreatedByMe: false,
}
vi.mock('../hooks/use-apps-query-state', () => ({
  default: () => ({
    query: mockQueryState,
    setQuery: mockSetQuery,
  }),
}))

let mockOnDSLFileDropped: ((file: File) => void) | null = null
let mockDragging = false
vi.mock('../hooks/use-dsl-drag-drop', () => ({
  useDSLDragDrop: ({ onDSLFileDropped }: { onDSLFileDropped: (file: File) => void }) => {
    mockOnDSLFileDropped = onDSLFileDropped
    return { dragging: mockDragging }
  },
}))

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

vi.mock('@/service/tag', () => ({
  fetchTagList: vi.fn().mockResolvedValue([{ id: 'tag-1', name: 'Test Tag', type: 'app' }]),
}))

vi.mock('@/config', () => ({
  NEED_REFRESH_APP_LIST_KEY: 'needRefreshAppList',
}))

vi.mock('@/hooks/use-pay', () => ({
  CheckModal: () => null,
}))

vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<unknown>) => {
    const fnString = importFn.toString()

    if (fnString.includes('tag-management')) {
      return function MockTagManagement() {
        return React.createElement('div', { 'data-testid': 'tag-management-modal' })
      }
    }
    if (fnString.includes('create-from-dsl-modal')) {
      return function MockCreateFromDSLModal({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess: () => void }) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'create-dsl-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-dsl-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-dsl-modal' }, 'Success'))
      }
    }
    return () => null
  },
}))

vi.mock('../app-card', () => ({
  default: ({ app }: { app: { id: string, name: string } }) => {
    return React.createElement('div', { 'data-testid': `app-card-${app.id}`, 'role': 'article' }, app.name)
  },
}))

vi.mock('../new-app-card', () => ({
  default: React.forwardRef((_props: unknown, _ref: React.ForwardedRef<unknown>) => {
    return React.createElement('div', { 'data-testid': 'new-app-card', 'role': 'button' }, 'New App Card')
  }),
}))

vi.mock('../empty', () => ({
  default: () => {
    return React.createElement('div', { 'data-testid': 'empty-state', 'role': 'status' }, 'No apps found')
  },
}))

vi.mock('../footer', () => ({
  default: () => {
    return React.createElement('footer', { 'data-testid': 'footer', 'role': 'contentinfo' }, 'Footer')
  },
}))

let intersectionCallback: IntersectionObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

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

// Render helper wrapping with NuqsTestingAdapter
const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
const renderList = (searchParams = '') => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      {children}
    </NuqsTestingAdapter>
  )
  return render(<List />, { wrapper })
}

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onUrlUpdate.mockClear()
    useTagStore.setState({
      tagList: [{ id: 'tag-1', name: 'Test Tag', type: 'app', binding_count: 0 }],
      showTagManagementModal: false,
    })
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockDragging = false
    mockOnDSLFileDropped = null
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
      renderList()
      expect(screen.getByText('app.types.all')).toBeInTheDocument()
    })

    it('should render tab slider with all app types', () => {
      renderList()

      expect(screen.getByText('app.types.all')).toBeInTheDocument()
      expect(screen.getByText('app.types.workflow')).toBeInTheDocument()
      expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
      expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
      expect(screen.getByText('app.types.agent')).toBeInTheDocument()
      expect(screen.getByText('app.types.completion')).toBeInTheDocument()
    })

    it('should render search input', () => {
      renderList()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render tag filter', () => {
      renderList()
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should render created by me checkbox', () => {
      renderList()
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })

    it('should render app cards when apps exist', () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
    })

    it('should render new app card for editors', () => {
      renderList()
      expect(screen.getByTestId('new-app-card')).toBeInTheDocument()
    })

    it('should render footer when branding is disabled', () => {
      renderList()
      expect(screen.getByTestId('footer')).toBeInTheDocument()
    })

    it('should render drop DSL hint for editors', () => {
      renderList()
      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should update URL when workflow tab is clicked', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.types.workflow'))

      await vi.waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const lastCall = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(lastCall.searchParams.get('category')).toBe(AppModeEnum.WORKFLOW)
    })

    it('should update URL when all tab is clicked', async () => {
      renderList('?category=workflow')

      fireEvent.click(screen.getByText('app.types.all'))

      await vi.waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const lastCall = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      // nuqs removes the default value ('all') from URL params
      expect(lastCall.searchParams.has('category')).toBe(false)
    })
  })

  describe('Search Functionality', () => {
    it('should render search input field', () => {
      renderList()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should handle search input change', () => {
      renderList()

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test search' } })

      expect(mockSetQuery).toHaveBeenCalled()
    })

    it('should handle search clear button click', () => {
      mockQueryState.keywords = 'existing search'

      renderList()

      const clearButton = document.querySelector('.group')
      expect(clearButton).toBeInTheDocument()
      if (clearButton)
        fireEvent.click(clearButton)

      expect(mockSetQuery).toHaveBeenCalled()
    })
  })

  describe('Tag Filter', () => {
    it('should render tag filter component', () => {
      renderList()
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })
  })

  describe('Created By Me Filter', () => {
    it('should render checkbox with correct label', () => {
      renderList()
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })

    it('should handle checkbox change', () => {
      renderList()

      const checkbox = screen.getByTestId('checkbox-undefined')
      fireEvent.click(checkbox)

      expect(mockSetQuery).toHaveBeenCalled()
    })
  })

  describe('Non-Editor User', () => {
    it('should not render new app card for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      renderList()

      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
    })

    it('should not render drop DSL hint for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      renderList()

      expect(screen.queryByText(/drop dsl file to create app/i)).not.toBeInTheDocument()
    })
  })

  describe('Dataset Operator Behavior', () => {
    it('should not trigger redirect at component level for dataset operators', () => {
      mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(true)

      renderList()

      expect(mockReplace).not.toHaveBeenCalled()
    })
  })

  describe('Local Storage Refresh', () => {
    it('should call refetch when refresh key is set in localStorage', () => {
      localStorage.setItem('needRefreshAppList', '1')

      renderList()

      expect(mockRefetch).toHaveBeenCalled()
      expect(localStorage.getItem('needRefreshAppList')).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple renders without issues', () => {
      const { rerender } = render(
        <NuqsTestingAdapter>
          <List />
        </NuqsTestingAdapter>,
      )
      expect(screen.getByText('app.types.all')).toBeInTheDocument()

      rerender(
        <NuqsTestingAdapter>
          <List />
        </NuqsTestingAdapter>,
      )
      expect(screen.getByText('app.types.all')).toBeInTheDocument()
    })

    it('should render app cards correctly', () => {
      renderList()

      expect(screen.getByText('Test App 1')).toBeInTheDocument()
      expect(screen.getByText('Test App 2')).toBeInTheDocument()
    })

    it('should render with all filter options visible', () => {
      renderList()

      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })
  })

  describe('Dragging State', () => {
    it('should show drop hint when DSL feature is enabled for editors', () => {
      renderList()
      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })

    it('should render dragging state overlay when dragging', () => {
      mockDragging = true
      const { container } = renderList()
      expect(container).toBeInTheDocument()
    })
  })

  describe('App Type Tabs', () => {
    it('should render all app type tabs', () => {
      renderList()

      expect(screen.getByText('app.types.all')).toBeInTheDocument()
      expect(screen.getByText('app.types.workflow')).toBeInTheDocument()
      expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
      expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
      expect(screen.getByText('app.types.agent')).toBeInTheDocument()
      expect(screen.getByText('app.types.completion')).toBeInTheDocument()
    })

    it('should update URL for each app type tab click', async () => {
      renderList()

      const appTypeTexts = [
        { mode: AppModeEnum.WORKFLOW, text: 'app.types.workflow' },
        { mode: AppModeEnum.ADVANCED_CHAT, text: 'app.types.advanced' },
        { mode: AppModeEnum.CHAT, text: 'app.types.chatbot' },
        { mode: AppModeEnum.AGENT_CHAT, text: 'app.types.agent' },
        { mode: AppModeEnum.COMPLETION, text: 'app.types.completion' },
      ]

      for (const { mode, text } of appTypeTexts) {
        onUrlUpdate.mockClear()
        fireEvent.click(screen.getByText(text))
        await vi.waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
        const lastCall = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
        expect(lastCall.searchParams.get('category')).toBe(mode)
      }
    })
  })

  describe('App List Display', () => {
    it('should display all app cards from data', () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
    })

    it('should display app names correctly', () => {
      renderList()

      expect(screen.getByText('Test App 1')).toBeInTheDocument()
      expect(screen.getByText('Test App 2')).toBeInTheDocument()
    })
  })

  describe('Footer Visibility', () => {
    it('should render footer when branding is disabled', () => {
      renderList()
      expect(screen.getByTestId('footer')).toBeInTheDocument()
    })
  })

  describe('DSL File Drop', () => {
    it('should handle DSL file drop and show modal', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()
    })

    it('should close DSL modal when onClose is called', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-dsl-modal'))

      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
    })

    it('should close DSL modal and refetch when onSuccess is called', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('success-dsl-modal'))

      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Infinite Scroll', () => {
    it('should call fetchNextPage when intersection observer triggers', () => {
      mockServiceState.hasNextPage = true
      renderList()

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
      renderList()

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
      renderList()

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
      const { container } = renderList()
      expect(container).toBeInTheDocument()
    })
  })
})
