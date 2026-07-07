import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'

import List from '../list'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'app.types.all': 'All',
    'app.studio.filters.types': 'Types',
    'app.studio.filters.creators': 'Creators',
    'app.studio.allApps': 'All Apps',
    'app.studio.sort.earliestCreated': 'Earliest created',
    'app.studio.sort.lastModified': 'Last modified',
    'app.studio.sort.recentlyCreated': 'Recently created',
    'app.studio.sort.sortBy': 'Sort by',
    'app.studio.starred': 'Starred',
  })
})

const mockAppListInfiniteOptions = vi.hoisted(() => vi.fn((options: unknown) => options))
const mockAppStarredListQueryOptions = vi.hoisted(() => vi.fn((options: unknown) => options))
const mockUseWorkflowOnlineUsers = vi.hoisted(() => vi.fn((_options: unknown) => ({
  onlineUsersMap: {},
})))

const mockReplace = vi.fn()
const mockRouter = { replace: mockReplace }
let mockSearchParams = new URLSearchParams('')
vi.mock('@/next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/apps',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: {
      get: vi.fn(),
    },
  },
  consoleQuery: {
    apps: {
      get: {
        infiniteOptions: (options: unknown) => mockAppListInfiniteOptions(options),
      },
      starred: {
        get: {
          queryOptions: (options: unknown) => mockAppStarredListQueryOptions(options),
        },
      },
    },
    tags: {
      get: {
        queryOptions: (options: unknown) => options,
      },
    },
    systemFeatures: {
      get: {
        queryKey: () => ['console', 'systemFeatures', 'get'],
      },
    },
  },
}))

const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
let mockWorkspacePermissionKeys = ['app.create_and_management']
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
    userProfile: { id: 'creator-1' },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
  useSelector: (selector: (state: {
    isCurrentWorkspaceDatasetOperator: boolean
    userProfile: { id: string }
    workspacePermissionKeys: string[]
  }) => unknown) => selector({
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
    userProfile: { id: 'creator-1' },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
}))

const mockOnPlanInfoChanged = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

const mockSetKeywords = vi.fn()
const mockSetCreatorIDs = vi.fn()
const mockSetCategory = vi.fn()
const mockQueryState = {
  category: 'all',
  keywords: '',
  creatorIDs: [] as string[],
}
vi.mock('../hooks/use-apps-query-state', () => ({
  useAppsQueryState: () => ({
    query: mockQueryState,
    setCategory: mockSetCategory,
    setKeywords: mockSetKeywords,
    setCreatorIDs: mockSetCreatorIDs,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'creator-1', name: 'Alice', avatar_url: null, status: 'active' },
        { id: 'creator-2', name: 'Bob', avatar_url: null, status: 'active' },
      ],
    },
  }),
}))

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: ({ value, onChange, onOpenTagManagement }: { value: string[], onChange: (value: string[]) => void, onOpenTagManagement: () => void }) => (
    <div>
      <button type="button" onClick={() => onChange(['tag-1'])}>common.tag.placeholder</button>
      <span data-testid="tag-filter-value">{value.join(',')}</span>
      <button type="button" onClick={onOpenTagManagement}>Manage tags</button>
    </div>
  ),
}))

let mockOnDSLFileDropped: ((file: File) => void) | null = null
let mockDragging = false
vi.mock('../hooks/use-dsl-drag-drop', () => ({
  useDSLDragDrop: ({ onDSLFileDropped }: { onDSLFileDropped: (file: File) => void }) => {
    mockOnDSLFileDropped = onDSLFileDropped
    return { dragging: mockDragging }
  },
}))

vi.mock('../hooks/use-workflow-online-users', () => ({
  useWorkflowOnlineUsers: (options: unknown) => mockUseWorkflowOnlineUsers(options),
}))

const mockRefetch = vi.fn()
const mockRefetchStarredAppList = vi.fn()
const mockFetchNextPage = vi.fn()

const mockServiceState = {
  error: null as Error | null,
  hasNextPage: false,
  isFetching: false,
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
let mockAppData = defaultAppData

type MockStarredAppData = {
  data: Array<Record<string, unknown>>
  total: number
  page: number
  limit: number
  has_more: boolean
}

let mockStarredAppData: MockStarredAppData = {
  data: [],
  total: 0,
  page: 1,
  limit: 100,
  has_more: false,
}

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({
      data: mockStarredAppData,
      isLoading: false,
      refetch: mockRefetchStarredAppList,
    }),
    useInfiniteQuery: () => ({
      data: mockAppData,
      isLoading: mockServiceState.isLoading,
      isFetching: mockServiceState.isFetching,
      isFetchingNextPage: mockServiceState.isFetchingNextPage,
      fetchNextPage: mockFetchNextPage,
      hasNextPage: mockServiceState.hasNextPage,
      error: mockServiceState.error,
      refetch: mockRefetch,
    }),
  }
})

vi.mock('@/service/use-apps', () => ({
  normalizeAppPagination: (response: unknown) => response,
  useDeleteAppMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useToggleAppStarMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
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
        return React.createElement('div', { 'data-testid': 'create-dsl-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-dsl-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-dsl-modal' }, 'Success'))
      }
    }
    if (fnString.includes('create-app-modal')) {
      return function MockCreateAppModal({ show, onClose, onSuccess, onCreateFromTemplate }: { show: boolean, onClose: () => void, onSuccess: () => void, onCreateFromTemplate: () => void }) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'create-app-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-create-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-create-modal' }, 'Success'), React.createElement('button', { 'onClick': onCreateFromTemplate, 'data-testid': 'to-template-modal' }, 'To Template'))
      }
    }
    if (fnString.includes('create-app-dialog')) {
      return function MockCreateAppTemplateDialog({ show, onClose, onSuccess, onCreateFromBlank }: { show: boolean, onClose: () => void, onSuccess: () => void, onCreateFromBlank: () => void }) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'template-dialog' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-template-dialog' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-template-dialog' }, 'Success'), React.createElement('button', { 'onClick': onCreateFromBlank, 'data-testid': 'to-blank-modal' }, 'To Blank'))
      }
    }
    return () => null
  },
}))

vi.mock('../app-card', () => ({
  AppCard: ({ app }: { app: { id: string, name: string } }) => {
    return React.createElement('div', { 'data-testid': `app-card-${app.id}`, 'role': 'article' }, app.name)
  },
  AppCardActionBar: ({ app, onRefresh }: { app: { id: string }, onRefresh?: () => void }) => {
    return React.createElement('button', {
      'data-testid': `app-card-action-bar-${app.id}`,
      'type': 'button',
      'onClick': onRefresh,
    })
  },
  default: ({ app }: { app: { id: string, name: string } }) => {
    return React.createElement('div', { 'data-testid': `app-card-${app.id}`, 'role': 'article' }, app.name)
  },
}))

vi.mock('../empty', () => ({
  default: () => {
    return React.createElement('div', { 'data-testid': 'empty-state', 'role': 'status' }, 'No apps found')
  },
}))

vi.mock('@/app/components/explore/learn-dify', () => ({
  default: ({ title }: { title?: string }) => React.createElement('section', null, title),
}))

const intersectionCallbacks: IntersectionObserverCallback[] = []
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

beforeAll(() => {
  globalThis.IntersectionObserver = class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallbacks.push(callback)
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

// Render helper wrapping with shared nuqs testing helper plus a seeded
// systemFeatures cache so List can resolve its useSuspenseQuery.
type RenderListOptions = {
  systemFeatures?: Partial<GetSystemFeaturesResponse>
}

const renderList = (searchParams = '', options: RenderListOptions = {}) => {
  mockSearchParams = new URLSearchParams(searchParams)
  const { wrapper: SystemFeaturesWrapper } = createSystemFeaturesWrapper({
    systemFeatures: { branding: { enabled: false }, ...options.systemFeatures },
  })
  return renderWithNuqs(<SystemFeaturesWrapper><List /></SystemFeaturesWrapper>, { searchParams })
}

type AppListInfiniteOptions = {
  input: (pageParam: number) => { query: Record<string, unknown> }
  getNextPageParam: (lastPage: { has_more: boolean, page: number }) => number | undefined
}

type AppStarredListQueryOptions = {
  input: {
    query: Record<string, unknown>
  }
}

const openAppTypeSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('button', { name: /^(Types|app\.types\.)/ }))
  return user
}

const openAppSortSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('button', { name: 'Sort by Last modified' }))
  return user
}

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockWorkspacePermissionKeys = ['app.create_and_management']
    mockDragging = false
    mockOnDSLFileDropped = null
    mockServiceState.error = null
    mockServiceState.hasNextPage = false
    mockServiceState.isLoading = false
    mockServiceState.isFetchingNextPage = false
    mockQueryState.category = 'all'
    mockQueryState.keywords = ''
    mockQueryState.creatorIDs = []
    mockAppData = defaultAppData
    mockStarredAppData = {
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      has_more: false,
    }
    mockUseWorkflowOnlineUsers.mockClear()
    mockRefetchStarredAppList.mockClear()
    intersectionCallbacks.length = 0
    localStorage.clear()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = renderList()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()
      expect(container.querySelector('.i-ri-filter-3-line')).not.toBeInTheDocument()
    })

    it('should render app type select with all app types', async () => {
      renderList()
      await openAppTypeSelect()

      expect(await screen.findByRole('menuitemradio', { name: 'All' }))!.toBeInTheDocument()
      expect(screen.queryByRole('menuitemradio', { name: 'Types' })).not.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.workflow' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.advanced' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.chatbot' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.agent' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.newApp.completeApp' }))!.toBeInTheDocument()
    })

    it('should render search input', () => {
      renderList()
      expect(screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' }))!.toBeInTheDocument()
    })

    it('should render tag filter', () => {
      renderList()
      expect(screen.getByText('common.tag.placeholder'))!.toBeInTheDocument()
    })

    it('should render creators filter', () => {
      renderList()
      expect(screen.getByRole('button', { name: 'Creators' }))!.toBeInTheDocument()
    })

    it('should render create button for editors', () => {
      renderList()
      expect(screen.getByRole('button', { name: 'common.operation.create' }))!.toBeInTheDocument()
    })

    it('should render filters and search before the right aligned actions', () => {
      renderList()

      const creatorsButton = screen.getByRole('button', { name: 'Creators' })
      const searchInput = screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' })
      const sortButton = screen.getByRole('button', { name: 'Sort by Last modified' })
      const snippetsLink = screen.getByRole('link', { name: 'app.studio.viewSnippets' })
      const createButton = screen.getByRole('button', { name: 'common.operation.create' })

      expect(snippetsLink).toHaveAttribute('href', '/snippets')
      expect(creatorsButton.compareDocumentPosition(sortButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(sortButton.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(searchInput.compareDocumentPosition(snippetsLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(snippetsLink.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('should render app cards when apps exist', () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2'))!.toBeInTheDocument()
    })

    it('should lay out app cards with auto-fill grid columns', () => {
      renderList()

      const grid = screen.getByTestId('app-card-app-1').parentElement

      expect(grid).toHaveClass(
        'grid',
        'grid-cols-[repeat(auto-fill,minmax(296px,1fr))]',
      )
    })

    it('should hide starred section when there are no starred apps', () => {
      renderList()

      expect(screen.queryByText('Starred')).not.toBeInTheDocument()
      expect(screen.queryByText('All Apps')).not.toBeInTheDocument()
    })

    it('should render starred apps before all app cards when starred apps exist', () => {
      mockStarredAppData = {
        data: [{
          id: 'starred-app-1',
          name: 'Starred App',
          description: 'Starred description',
          mode: AppModeEnum.CHAT,
          icon: '⭐',
          icon_type: 'emoji',
          icon_background: '#FFEAD5',
          icon_url: null,
          tags: [],
          author_name: 'Author 1',
          created_at: 1704067200,
          updated_at: 1704153600,
        }],
        total: 1,
        page: 1,
        limit: 100,
        has_more: false,
      }

      renderList()

      const starredLabel = screen.getByText('Starred')
      const starredCard = screen.getByRole('link', { name: /Starred App/ })
      const allAppsLabel = screen.getByText('All Apps')
      const firstAppCard = screen.getByTestId('app-card-app-1')
      const actionBar = screen.getByTestId('app-card-action-bar-starred-app-1')

      expect(starredCard).toBeInTheDocument()
      expect(actionBar).toBeInTheDocument()
      expect(starredLabel.compareDocumentPosition(starredCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(starredCard.compareDocumentPosition(allAppsLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(allAppsLabel.compareDocumentPosition(firstAppCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      fireEvent.click(actionBar)

      expect(mockRefetch).toHaveBeenCalledTimes(1)
      expect(mockRefetchStarredAppList).toHaveBeenCalledTimes(1)
    })

    it('should not render new app card in the app grid', () => {
      renderList()
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
    })

    it('should render drop DSL hint when app creation permission is available', () => {
      renderList()
      expect(screen.getByText('app.newApp.dropDSLToCreateApp'))!.toBeInTheDocument()
    })

    it('should render first empty state when there are no apps and no active filters', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList('', { systemFeatures: { enable_learn_app: true } })

      expect(screen.getByText('app.firstEmpty.title'))!.toBeInTheDocument()
      expect(screen.getByText('app.firstEmpty.learnDifyTitle'))!.toBeInTheDocument()
      expect(screen.getByText('app.firstEmpty.or'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    })

    it('should lay out first empty state placeholder cards with auto-fill grid columns', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      const { container } = renderList()
      const placeholderGrid = Array.from(container.querySelectorAll('.pointer-events-none'))
        .find(element => element.className.includes('grid-rows-4'))

      if (!placeholderGrid)
        throw new Error('Expected first empty state placeholder grid to render')

      expect(placeholderGrid).toHaveClass(
        'grid',
        'grid-cols-[repeat(auto-fill,minmax(296px,1fr))]',
        'grid-rows-4',
      )
      expect(placeholderGrid).not.toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4')
    })

    it('should hide learn dify in first empty state when learn app is disabled', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList('', { systemFeatures: { enable_learn_app: false } })

      expect(screen.getByText('app.firstEmpty.title'))!.toBeInTheDocument()
      expect(screen.queryByText('app.firstEmpty.learnDifyTitle')).not.toBeInTheDocument()
    })

    it('should not render first empty state before the first app list page resolves', () => {
      mockAppData = { pages: [] }

      renderList()

      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()
    })

    it('should keep the regular empty state for empty filtered results', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }
      mockQueryState.keywords = 'missing app'

      renderList()

      expect(screen.getByTestId('empty-state'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
    })

    it('should open create flows from first empty state actions', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList()

      fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.startFromBlank/ }))
      expect(screen.getByTestId('create-app-modal'))!.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.startFromTemplate/ }))
      expect(screen.getByTestId('template-dialog'))!.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /app\.importDSL/ }))
      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()
    })

    it('should pass workflow app ids to online users hook', () => {
      renderList()

      expect(mockUseWorkflowOnlineUsers).toHaveBeenCalledWith({
        appIds: ['app-2'],
        enabled: expect.any(Boolean),
      })
    })
  })

  describe('App Type Select', () => {
    it('should render selected category in the trigger', () => {
      mockQueryState.category = AppModeEnum.WORKFLOW

      renderList()

      expect(screen.getByRole('button', { name: 'app.types.workflow' }))!.toBeInTheDocument()
    })

    it('should update category when workflow option is selected', async () => {
      const user = userEvent.setup()
      renderList()
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('menuitemradio', { name: 'app.types.workflow' }))

      expect(mockSetCategory).toHaveBeenCalledWith(AppModeEnum.WORKFLOW)
    })

    it('should update category when all option is selected', async () => {
      const user = userEvent.setup()
      mockQueryState.category = AppModeEnum.WORKFLOW
      renderList()
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('menuitemradio', { name: 'All' }))

      expect(mockSetCategory).toHaveBeenCalledWith('all')
    })
  })

  describe('Search Functionality', () => {
    it('should render search input field', () => {
      renderList()
      expect(screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' }))!.toBeInTheDocument()
    })

    it('should handle search input change', () => {
      renderList()

      const input = screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' })
      fireEvent.change(input, { target: { value: 'test search' } })

      expect(mockSetKeywords).toHaveBeenCalledWith('test search')
    })

    it('should handle search clear button click', () => {
      mockQueryState.keywords = 'existing search'

      renderList()

      const clearButton = document.querySelector('.i-ri-close-circle-fill')?.closest('button')
      expect(clearButton)!.toBeInTheDocument()
      if (clearButton)
        fireEvent.click(clearButton)

      expect(mockSetKeywords).toHaveBeenCalledWith('')
    })
  })

  describe('App List Query', () => {
    it('should build paged query input from active filters', () => {
      mockQueryState.keywords = 'sales'
      mockQueryState.creatorIDs = ['creator-1']
      mockQueryState.category = AppModeEnum.WORKFLOW

      renderList()
      fireEvent.click(screen.getByText('common.tag.placeholder'))

      const options = mockAppListInfiniteOptions.mock.calls.at(-1)?.[0] as AppListInfiniteOptions

      expect(options.input(2)).toEqual({
        query: {
          page: 2,
          limit: 30,
          name: 'sales',
          sort_by: 'last_modified',
          tag_ids: ['tag-1'],
          creator_ids: ['creator-1'],
          mode: AppModeEnum.WORKFLOW,
        },
      })
      expect(options.getNextPageParam({ has_more: true, page: 2 })).toBe(3)
      expect(options.getNextPageParam({ has_more: false, page: 2 })).toBeUndefined()
    })

    it('should build starred query input from active filters with the starred limit', () => {
      mockQueryState.keywords = 'sales'
      mockQueryState.creatorIDs = ['creator-1']
      mockQueryState.category = AppModeEnum.WORKFLOW

      renderList()
      fireEvent.click(screen.getByText('common.tag.placeholder'))

      const options = mockAppStarredListQueryOptions.mock.calls.at(-1)?.[0] as AppStarredListQueryOptions

      expect(options.input).toEqual({
        query: {
          page: 1,
          limit: 100,
          name: 'sales',
          sort_by: 'last_modified',
          tag_ids: ['tag-1'],
          creator_ids: ['creator-1'],
          mode: AppModeEnum.WORKFLOW,
        },
      })
    })
  })

  describe('Tag Filter', () => {
    it('should render tag filter component', () => {
      renderList()
      expect(screen.getByText('common.tag.placeholder'))!.toBeInTheDocument()
    })
  })

  describe('Creators Filter', () => {
    it('should render creators filter with correct label', () => {
      renderList()
      expect(screen.getByRole('button', { name: 'Creators' }))!.toBeInTheDocument()
    })

    it('should handle creator selection', () => {
      renderList()

      fireEvent.click(screen.getByRole('button', { name: 'Creators' }))
      fireEvent.click(screen.getByRole('button', { name: /Bob/ }))

      expect(mockSetCreatorIDs).toHaveBeenCalledWith(['creator-2'])
    })
  })

  describe('Create Menu', () => {
    it('should render all create menu options', async () => {
      renderList()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))

      expect(await screen.findByText('app.newApp.startFromBlank'))!.toBeInTheDocument()
      expect(await screen.findByText('app.newApp.startFromTemplate'))!.toBeInTheDocument()
      expect(await screen.findByText('app.importDSL'))!.toBeInTheDocument()
      expect(await screen.findAllByText('app.newApp.dropDSLToCreateApp')).toHaveLength(2)
    })

    it('should open blank app modal from create menu', async () => {
      renderList()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      fireEvent.click(await screen.findByText('app.newApp.startFromBlank'))

      expect(screen.getByTestId('create-app-modal'))!.toBeInTheDocument()
    })

    it('should open template dialog from create menu', async () => {
      renderList()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      fireEvent.click(await screen.findByText('app.newApp.startFromTemplate'))

      expect(screen.getByTestId('template-dialog'))!.toBeInTheDocument()
    })

    it('should open DSL import modal from create menu', async () => {
      renderList()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))
      fireEvent.click(await screen.findByText('app.importDSL'))

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()
    })

    it('should not render create button without app creation permission', () => {
      mockWorkspacePermissionKeys = []

      renderList()

      expect(screen.queryByRole('button', { name: 'common.operation.create' })).not.toBeInTheDocument()
    })
  })

  describe('User Without App Creation Permission', () => {
    it('should not render new app card without app creation permission', () => {
      mockWorkspacePermissionKeys = []

      renderList()

      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
    })

    it('should not render drop DSL hint without app creation permission', () => {
      mockWorkspacePermissionKeys = []

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
      const { unmount } = renderList()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()

      unmount()
      renderList()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()
    })

    it('should render app cards correctly', () => {
      renderList()

      expect(screen.getByText('Test App 1'))!.toBeInTheDocument()
      expect(screen.getByText('Test App 2'))!.toBeInTheDocument()
    })

    it('should render with all filter options visible', () => {
      renderList()

      expect(screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' }))!.toBeInTheDocument()
      expect(screen.getByText('common.tag.placeholder'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Creators' }))!.toBeInTheDocument()
    })
  })

  describe('Dragging State', () => {
    it('should show drop hint when DSL feature is enabled for editors', () => {
      renderList()
      expect(screen.getByText('app.newApp.dropDSLToCreateApp'))!.toBeInTheDocument()
    })

    it('should render dragging state overlay when dragging', () => {
      mockDragging = true
      const { container } = renderList()
      expect(container)!.toBeInTheDocument()
    })
  })

  describe('App Type Select Options', () => {
    it('should render all app type options', async () => {
      renderList()
      await openAppTypeSelect()

      expect(await screen.findByRole('menuitemradio', { name: 'All' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.workflow' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.advanced' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.chatbot' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.types.agent' }))!.toBeInTheDocument()
      expect(await screen.findByRole('menuitemradio', { name: 'app.newApp.completeApp' }))!.toBeInTheDocument()
    })

    it('should update category for each app type option click', async () => {
      const appTypeTexts = [
        { mode: AppModeEnum.WORKFLOW, text: 'app.types.workflow' },
        { mode: AppModeEnum.ADVANCED_CHAT, text: 'app.types.advanced' },
        { mode: AppModeEnum.CHAT, text: 'app.types.chatbot' },
        { mode: AppModeEnum.AGENT_CHAT, text: 'app.types.agent' },
        { mode: AppModeEnum.COMPLETION, text: 'app.newApp.completeApp' },
      ]

      for (const { mode, text } of appTypeTexts) {
        const user = userEvent.setup()
        const { unmount } = renderList()
        await openAppTypeSelect(user)
        mockSetCategory.mockClear()
        await user.click(await screen.findByRole('menuitemradio', { name: text }))
        expect(mockSetCategory).toHaveBeenCalledWith(mode)
        unmount()
      }
    })

    it('should update app list query when sort option changes', async () => {
      const user = userEvent.setup()
      renderList()
      await openAppSortSelect(user)

      await user.click(await screen.findByRole('menuitemradio', { name: 'Recently created' }))

      const options = mockAppListInfiniteOptions.mock.calls.at(-1)?.[0] as AppListInfiniteOptions
      expect(options.input(1).query.sort_by).toBe('recently_created')
    })
  })

  describe('App List Display', () => {
    it('should display all app cards from data', () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2'))!.toBeInTheDocument()
    })

    it('should display app names correctly', () => {
      renderList()

      expect(screen.getByText('Test App 1'))!.toBeInTheDocument()
      expect(screen.getByText('Test App 2'))!.toBeInTheDocument()
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

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()
    })

    it('should close DSL modal when onClose is called', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      act(() => {
        if (mockOnDSLFileDropped)
          mockOnDSLFileDropped(mockFile)
      })

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()

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

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('success-dsl-modal'))

      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Infinite Scroll', () => {
    it('should call fetchNextPage when intersection observer triggers', async () => {
      mockServiceState.hasNextPage = true
      renderList()

      await waitFor(() => {
        expect(mockObserve).toHaveBeenCalled()
      })

      for (const callback of intersectionCallbacks) {
        act(() => {
          callback(
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

      for (const callback of intersectionCallbacks) {
        act(() => {
          callback(
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

      for (const callback of intersectionCallbacks) {
        act(() => {
          callback(
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
      expect(container)!.toBeInTheDocument()
    })
  })
})
