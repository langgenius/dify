import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'

import List from '../list'

const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
const mockIsLoadingCurrentWorkspace = vi.fn(() => false)

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
    isLoadingCurrentWorkspace: mockIsLoadingCurrentWorkspace(),
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
  isFetching: false,
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
    isFetching: mockServiceState.isFetching,
    isFetchingNextPage: mockServiceState.isFetchingNextPage,
    fetchNextPage: mockFetchNextPage,
    hasNextPage: mockServiceState.hasNextPage,
    error: mockServiceState.error,
    refetch: mockRefetch,
  }),
  useDeleteAppMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
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

        return React.createElement(
          'div',
          { 'data-testid': 'create-dsl-modal' },
          React.createElement('button', { 'data-testid': 'close-dsl-modal', 'onClick': onClose }, 'Close'),
          React.createElement('button', { 'data-testid': 'success-dsl-modal', 'onClick': onSuccess }, 'Success'),
        )
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

const renderList = (props: React.ComponentProps<typeof List> = {}, searchParams = '') => {
  return renderWithNuqs(<List {...props} />, { searchParams })
}

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTagStore.setState({
      tagList: [{ id: 'tag-1', name: 'Test Tag', type: 'app', binding_count: 0 }],
      showTagManagementModal: false,
    })
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockIsLoadingCurrentWorkspace.mockReturnValue(false)
    mockDragging = false
    mockOnDSLFileDropped = null
    mockServiceState.error = null
    mockServiceState.hasNextPage = false
    mockServiceState.isLoading = false
    mockServiceState.isFetching = false
    mockServiceState.isFetchingNextPage = false
    mockQueryState.tagIDs = []
    mockQueryState.keywords = ''
    mockQueryState.isCreatedByMe = false
    intersectionCallback = null
    localStorage.clear()
  })

  describe('Apps Mode', () => {
    it('should render the apps route switch, dropdown filters, and app cards', () => {
      renderList()

      expect(screen.getByRole('link', { name: 'app.studio.apps' })).toHaveAttribute('href', '/apps')
      expect(screen.getByRole('link', { name: 'workflow.tabs.snippets' })).toHaveAttribute('href', '/snippets')
      expect(screen.getByText('app.studio.filters.types')).toBeInTheDocument()
      expect(screen.getByText('app.studio.filters.creators')).toBeInTheDocument()
      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
      expect(screen.getByTestId('new-app-card')).toBeInTheDocument()
    })

    it('should update the category query when selecting an app type from the dropdown', async () => {
      const { onUrlUpdate } = renderList()

      fireEvent.click(screen.getByText('app.studio.filters.types'))
      fireEvent.click(await screen.findByText('app.types.workflow'))

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const lastCall = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(lastCall.searchParams.get('category')).toBe(AppModeEnum.WORKFLOW)
    })

    it('should keep the creators dropdown visual-only and not update app query state', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.studio.filters.creators'))
      fireEvent.click(await screen.findByText('Evan'))

      expect(mockSetQuery).not.toHaveBeenCalled()
      expect(screen.getByText('app.studio.filters.creators +1')).toBeInTheDocument()
    })

    it('should render and close the DSL import modal when a file is dropped', () => {
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
  })

  describe('Snippets Mode', () => {
    it('should render the snippets create card and fake snippet card', () => {
      renderList({ pageType: 'snippets' })

      expect(screen.getByText('snippet.create')).toBeInTheDocument()
      expect(screen.getByText('Tone Rewriter')).toBeInTheDocument()
      expect(screen.getByText('Rewrites rough drafts into a concise, professional tone for internal stakeholder updates.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Tone Rewriter/i })).toHaveAttribute('href', '/snippets/snippet-1')
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument()
    })

    it('should filter local snippets by the search input and show the snippet empty state', () => {
      renderList({ pageType: 'snippets' })

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'missing snippet' } })

      expect(screen.queryByText('Tone Rewriter')).not.toBeInTheDocument()
      expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
    })

    it('should not render app-only controls in snippets mode', () => {
      renderList({ pageType: 'snippets' })

      expect(screen.queryByText('app.studio.filters.types')).not.toBeInTheDocument()
      expect(screen.queryByText('common.tag.placeholder')).not.toBeInTheDocument()
      expect(screen.queryByText('app.newApp.dropDSLToCreateApp')).not.toBeInTheDocument()
    })

    it('should reserve the infinite-scroll anchor without fetching more pages', () => {
      renderList({ pageType: 'snippets' })

      act(() => {
        intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      })

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })
  })
})
