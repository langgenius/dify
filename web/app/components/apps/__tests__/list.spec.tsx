import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'

import List from '../list'

const mockReplace = vi.fn()
const mockRouter = { replace: mockReplace }
vi.mock('@/next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(''),
}))

const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
const mockIsLoadingCurrentWorkspace = vi.fn(() => false)
const mockCanAccessSnippetsAndEvaluation = vi.fn(() => true)

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

vi.mock('@/hooks/use-snippet-and-evaluation-plan-access', () => ({
  useSnippetAndEvaluationPlanAccess: () => ({
    canAccess: mockCanAccessSnippetsAndEvaluation(),
    isReady: true,
  }),
}))

const mockSetQuery = vi.fn()
const mockQueryState = {
  tagIDs: [] as string[],
  creatorIDs: [] as string[],
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
const mockFetchSnippetNextPage = vi.fn()
const mockUseInfiniteAppList = vi.fn()
const mockUseInfiniteSnippetList = vi.fn()

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
  useInfiniteAppList: (params: unknown, options: unknown) => {
    mockUseInfiniteAppList(params, options)
    return {
      data: defaultAppData,
      isLoading: mockServiceState.isLoading,
      isFetching: mockServiceState.isFetching,
      isFetchingNextPage: mockServiceState.isFetchingNextPage,
      fetchNextPage: mockFetchNextPage,
      hasNextPage: mockServiceState.hasNextPage,
      error: mockServiceState.error,
      refetch: mockRefetch,
    }
  },
  useDeleteAppMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

const mockSnippetServiceState = {
  error: null as Error | null,
  hasNextPage: false,
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
}

const defaultSnippetData = {
  pages: [{
    data: [
      {
        id: 'snippet-1',
        name: 'Tone Rewriter',
        description: 'Rewrites rough drafts into a concise, professional tone for internal stakeholder updates.',
        type: 'node',
        is_published: false,
        use_count: 19,
        icon_info: {
          icon_type: 'emoji',
          icon: '🪄',
          icon_background: '#E0EAFF',
          icon_url: '',
        },
        created_at: 1704067200,
        updated_at: '2024-01-02 10:00',
        author: '',
      },
    ],
    total: 1,
  }],
}

vi.mock('@/service/use-snippets', () => ({
  useInfiniteSnippetList: (params: unknown, options: unknown) => {
    mockUseInfiniteSnippetList(params, options)
    return {
      data: defaultSnippetData,
      isLoading: mockSnippetServiceState.isLoading,
      isFetching: mockSnippetServiceState.isFetching,
      isFetchingNextPage: mockSnippetServiceState.isFetchingNextPage,
      fetchNextPage: mockFetchSnippetNextPage,
      hasNextPage: mockSnippetServiceState.hasNextPage,
      error: mockSnippetServiceState.error,
    }
  },
  useCreateSnippetMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useImportSnippetDSLMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useConfirmSnippetImportMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/service/tag', () => ({
  fetchTagList: vi.fn().mockResolvedValue([{ id: 'tag-1', name: 'Test Tag', type: 'app' }]),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    NEED_REFRESH_APP_LIST_KEY: 'needRefreshAppList',
  }
})

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'user-1', name: 'Current User', email: 'current@example.com', avatar: '', avatar_url: '', role: 'owner', last_login_at: '', created_at: '', status: 'active' },
        { id: 'user-2', name: 'Alice', email: 'alice@example.com', avatar: '', avatar_url: '', role: 'admin', last_login_at: '', created_at: '', status: 'active' },
      ],
    },
  }),
}))

vi.mock('@/hooks/use-pay', () => ({
  CheckModal: () => null,
}))

vi.mock('@/next/dynamic', () => ({
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
  default: ({ message }: { message: string }) => {
    return React.createElement('div', { 'data-testid': 'empty-state', 'role': 'status' }, message)
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
    defaultSnippetData.pages[0].data = [
      {
        id: 'snippet-1',
        name: 'Tone Rewriter',
        description: 'Rewrites rough drafts into a concise, professional tone for internal stakeholder updates.',
        type: 'node',
        is_published: false,
        use_count: 19,
        icon_info: {
          icon_type: 'emoji',
          icon: '🪄',
          icon_background: '#E0EAFF',
          icon_url: '',
        },
        created_at: 1704067200,
        updated_at: '2024-01-02 10:00',
        author: '',
      },
    ]
    defaultSnippetData.pages[0].total = 1
    useTagStore.setState({
      tagList: [{ id: 'tag-1', name: 'Test Tag', type: 'app', binding_count: 0 }],
      showTagManagementModal: false,
    })
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockIsLoadingCurrentWorkspace.mockReturnValue(false)
    mockCanAccessSnippetsAndEvaluation.mockReturnValue(true)
    mockDragging = false
    mockOnDSLFileDropped = null
    mockServiceState.error = null
    mockServiceState.hasNextPage = false
    mockServiceState.isLoading = false
    mockServiceState.isFetching = false
    mockServiceState.isFetchingNextPage = false
    mockQueryState.tagIDs = []
    mockQueryState.creatorIDs = []
    mockQueryState.keywords = ''
    mockQueryState.isCreatedByMe = false
    mockSnippetServiceState.error = null
    mockSnippetServiceState.hasNextPage = false
    mockSnippetServiceState.isLoading = false
    mockSnippetServiceState.isFetching = false
    mockSnippetServiceState.isFetchingNextPage = false
    mockUseInfiniteAppList.mockClear()
    mockUseInfiniteSnippetList.mockClear()
    intersectionCallback = null
    localStorage.clear()
  })

  describe('Apps Mode', () => {
    it('should render the apps route switch, dropdown filters, and app cards', () => {
      renderList()

      expect(screen.getByRole('link', { name: 'app.studio.apps' })).toHaveAttribute('href', '/apps')
      expect(screen.getByRole('link', { name: 'workflow.tabs.snippets' })).toHaveAttribute('href', '/snippets')
      expect(screen.getByText('app.studio.filters.types')).toBeInTheDocument()
      expect(screen.getByText('app.studio.filters.allCreators')).toBeInTheDocument()
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

    it('should update creatorIDs when selecting a creator from the dropdown', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.studio.filters.allCreators'))
      fireEvent.click(await screen.findByText('Current User'))

      expect(mockSetQuery).toHaveBeenCalledTimes(1)
    })

    it('should pass creator_id to the app list query when creatorIDs are selected', () => {
      mockQueryState.creatorIDs = ['user-1', 'user-2']

      renderList()

      expect(mockUseInfiniteAppList).toHaveBeenCalledWith(expect.objectContaining({
        creator_id: 'user-1,user-2',
      }), expect.any(Object))
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
      const { unmount } = renderWithNuqs(<List />)
      expect(screen.getByText('app.types.all')).toBeInTheDocument()

      unmount()
      renderList()
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
      const { onUrlUpdate } = renderList()

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
      fireEvent.click(screen.getByTestId('close-dsl-modal'))
      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
    })

    it('should hide the snippets route switch when snippet access is unavailable', () => {
      mockCanAccessSnippetsAndEvaluation.mockReturnValue(false)

      renderList()

      expect(screen.getByRole('link', { name: 'app.studio.apps' })).toHaveAttribute('href', '/apps')
      expect(screen.queryByRole('link', { name: 'workflow.tabs.snippets' })).not.toBeInTheDocument()
    })
  })

  describe('Snippets Mode', () => {
    it('should render the snippets create card and snippet card from the real query hook', () => {
      renderList({ pageType: 'snippets' })

      expect(screen.getByText('snippet.create')).toBeInTheDocument()
      expect(screen.getByText('Tone Rewriter')).toBeInTheDocument()
      expect(screen.getByText('Rewrites rough drafts into a concise, professional tone for internal stakeholder updates.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Tone Rewriter/i })).toHaveAttribute('href', '/snippets/snippet-1/orchestrate')
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument()
    })

    it('should request the next snippet page when the infinite-scroll anchor intersects', () => {
      mockSnippetServiceState.hasNextPage = true
      renderList({ pageType: 'snippets' })

      act(() => {
        intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      })

      expect(mockFetchSnippetNextPage).toHaveBeenCalled()
    })

    it('should not render app-only controls in snippets mode', () => {
      renderList({ pageType: 'snippets' })

      expect(screen.queryByText('app.studio.filters.types')).not.toBeInTheDocument()
      expect(screen.queryByText('common.tag.placeholder')).not.toBeInTheDocument()
      expect(screen.queryByText('app.newApp.dropDSLToCreateApp')).not.toBeInTheDocument()
    })

    it('should pass creator_id to the snippet list query when creatorIDs are selected', () => {
      mockQueryState.creatorIDs = ['user-1', 'user-2']

      renderList({ pageType: 'snippets' })

      expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.objectContaining({
        creator_id: 'user-1,user-2',
      }), expect.any(Object))
    })

    it('should not fetch the next snippet page when no more data is available', () => {
      renderList({ pageType: 'snippets' })

      act(() => {
        intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      })

      expect(mockFetchSnippetNextPage).not.toHaveBeenCalled()
    })

    it('should reuse the shared empty state when no snippets are available', () => {
      defaultSnippetData.pages[0].data = []
      defaultSnippetData.pages[0].total = 0

      renderList({ pageType: 'snippets' })

      expect(screen.getByTestId('empty-state')).toHaveTextContent('workflow.tabs.noSnippetsFound')
    })
  })
})
