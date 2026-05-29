import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'

import List from '../list'

const mockAppListInfiniteOptions = vi.hoisted(() => vi.fn((options: unknown) => options))
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
    systemFeatures: vi.fn(),
  },
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: (options: unknown) => mockAppListInfiniteOptions(options),
      },
    },
    tags: {
      list: {
        queryOptions: (options: unknown) => options,
      },
    },
    systemFeatures: {
      queryKey: () => ['console', 'systemFeatures'],
    },
  },
}))

const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
  }),
}))

const mockOnPlanInfoChanged = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

const mockSetKeywords = vi.fn()
const mockSetIsCreatedByMe = vi.fn()
const mockSetCategory = vi.fn()
const mockQueryState = {
  category: 'all',
  keywords: '',
  isCreatedByMe: false,
  emptyAppList: false,
}
vi.mock('../hooks/use-apps-query-state', () => ({
  isAppListCategory: (value: string) => value === 'all' || Object.values(AppModeEnum).includes(value as AppModeEnum),
  useAppsQueryState: () => ({
    query: mockQueryState,
    setCategory: mockSetCategory,
    setKeywords: mockSetKeywords,
    setIsCreatedByMe: mockSetIsCreatedByMe,
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

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
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
  useDeleteAppMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    NEED_REFRESH_APP_LIST_KEY: 'needRefreshAppList',
  }
})

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

vi.mock('@/app/components/explore/learn-dify', () => ({
  default: ({ title }: { title?: string }) => React.createElement('section', null, title),
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

// Render helper wrapping with shared nuqs testing helper plus a seeded
// systemFeatures cache so List can resolve its useSuspenseQuery.
const renderList = (searchParams = '') => {
  mockSearchParams = new URLSearchParams(searchParams)
  const { wrapper: SystemFeaturesWrapper } = createSystemFeaturesWrapper({
    systemFeatures: { branding: { enabled: false } },
  })
  return renderWithNuqs(<SystemFeaturesWrapper><List /></SystemFeaturesWrapper>, { searchParams })
}

type AppListInfiniteOptions = {
  input: (pageParam: number) => { query: Record<string, unknown> }
  getNextPageParam: (lastPage: { has_more: boolean, page: number }) => number | undefined
}

const openAppTypeSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('combobox', { name: /^app\.types\./ }))
  return user
}

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockDragging = false
    mockOnDSLFileDropped = null
    mockServiceState.error = null
    mockServiceState.hasNextPage = false
    mockServiceState.isLoading = false
    mockServiceState.isFetchingNextPage = false
    mockQueryState.category = 'all'
    mockQueryState.keywords = ''
    mockQueryState.isCreatedByMe = false
    mockQueryState.emptyAppList = false
    mockAppData = defaultAppData
    mockUseWorkflowOnlineUsers.mockClear()
    intersectionCallback = null
    localStorage.clear()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderList()
      expect(screen.getByRole('combobox', { name: 'app.types.all' }))!.toBeInTheDocument()
    })

    it('should render app type select with all app types', async () => {
      renderList()
      await openAppTypeSelect()

      expect(await screen.findByRole('option', { name: 'app.types.all' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.workflow' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.advanced' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.chatbot' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.agent' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.completion' }))!.toBeInTheDocument()
    })

    it('should render search input', () => {
      renderList()
      expect(screen.getByRole('textbox'))!.toBeInTheDocument()
    })

    it('should render tag filter', () => {
      renderList()
      expect(screen.getByText('common.tag.placeholder'))!.toBeInTheDocument()
    })

    it('should render created by me checkbox', () => {
      renderList()
      expect(screen.getByText('app.showMyCreatedAppsOnly'))!.toBeInTheDocument()
    })

    it('should render create button for editors', () => {
      renderList()
      expect(screen.getByRole('button', { name: 'common.operation.create' }))!.toBeInTheDocument()
    })

    it('should render app cards when apps exist', () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2'))!.toBeInTheDocument()
    })

    it('should render new app card for editors', () => {
      renderList()
      expect(screen.getByTestId('new-app-card'))!.toBeInTheDocument()
    })

    it('should render footer when branding is disabled', () => {
      renderList()
      expect(screen.getByTestId('footer'))!.toBeInTheDocument()
    })

    it('should render drop DSL hint for editors', () => {
      renderList()
      expect(screen.getByText('app.newApp.dropDSLToCreateApp'))!.toBeInTheDocument()
    })

    it('should render first empty state when there are no apps and no active filters', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList()

      expect(screen.getByText('app.firstEmpty.title'))!.toBeInTheDocument()
      expect(screen.getByText('app.firstEmpty.description'))!.toBeInTheDocument()
      expect(screen.getByText('app.firstEmpty.learnDifyTitle'))!.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /^app\.types\./ })).not.toBeInTheDocument()
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
      expect(screen.queryByTestId('footer')).not.toBeInTheDocument()
    })

    it('should not render first empty state before the first app list page resolves', () => {
      mockAppData = { pages: [] }

      renderList()

      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'app.types.all' }))!.toBeInTheDocument()
    })

    it('should render first empty state when emptyAppList URL preview is enabled', () => {
      mockQueryState.emptyAppList = true

      renderList()

      expect(screen.getByText('app.firstEmpty.title'))!.toBeInTheDocument()
      expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /^app\.types\./ })).not.toBeInTheDocument()
      expect(screen.queryByTestId('footer')).not.toBeInTheDocument()
    })

    it('should keep the regular empty state for empty filtered results', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }
      mockQueryState.keywords = 'missing app'

      renderList()

      expect(screen.getByTestId('empty-state'))!.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'app.types.all' }))!.toBeInTheDocument()
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

      expect(screen.getByRole('combobox', { name: 'app.types.workflow' }))!.toBeInTheDocument()
    })

    it('should update category when workflow option is selected', async () => {
      const user = userEvent.setup()
      renderList()
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('option', { name: 'app.types.workflow' }))

      expect(mockSetCategory).toHaveBeenCalledWith(AppModeEnum.WORKFLOW)
    })

    it('should update category when all option is selected', async () => {
      const user = userEvent.setup()
      mockQueryState.category = AppModeEnum.WORKFLOW
      renderList()
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('option', { name: 'app.types.all' }))

      expect(mockSetCategory).toHaveBeenCalledWith('all')
    })
  })

  describe('Search Functionality', () => {
    it('should render search input field', () => {
      renderList()
      expect(screen.getByRole('textbox'))!.toBeInTheDocument()
    })

    it('should handle search input change', () => {
      renderList()

      const input = screen.getByRole('textbox')
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
      mockQueryState.isCreatedByMe = true
      mockQueryState.category = AppModeEnum.WORKFLOW

      renderList()
      fireEvent.click(screen.getByText('common.tag.placeholder'))

      const options = mockAppListInfiniteOptions.mock.calls.at(-1)?.[0] as AppListInfiniteOptions

      expect(options.input(2)).toEqual({
        query: {
          page: 2,
          limit: 30,
          name: 'sales',
          tag_ids: ['tag-1'],
          is_created_by_me: true,
          mode: AppModeEnum.WORKFLOW,
        },
      })
      expect(options.getNextPageParam({ has_more: true, page: 2 })).toBe(3)
      expect(options.getNextPageParam({ has_more: false, page: 2 })).toBeUndefined()
    })

    it('should remove legacy tagIDs from URL while preserving other filters', async () => {
      renderList('?category=workflow&tagIDs=tag-1;tag-2&keywords=sales&isCreatedByMe=true')

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/apps?category=workflow&keywords=sales&isCreatedByMe=true',
          { scroll: false },
        )
      })
    })
  })

  describe('Tag Filter', () => {
    it('should render tag filter component', () => {
      renderList()
      expect(screen.getByText('common.tag.placeholder'))!.toBeInTheDocument()
    })
  })

  describe('Created By Me Filter', () => {
    it('should render checkbox with correct label', () => {
      renderList()
      expect(screen.getByText('app.showMyCreatedAppsOnly'))!.toBeInTheDocument()
    })

    it('should handle checkbox change', () => {
      renderList()

      const checkbox = screen.getByRole('checkbox', { name: 'app.showMyCreatedAppsOnly' })
      fireEvent.click(checkbox)

      expect(mockSetIsCreatedByMe).toHaveBeenCalledWith(true)
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

    it('should not render create button for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      renderList()

      expect(screen.queryByRole('button', { name: 'common.operation.create' })).not.toBeInTheDocument()
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
      const { unmount } = renderList()
      expect(screen.getByRole('combobox', { name: 'app.types.all' }))!.toBeInTheDocument()

      unmount()
      renderList()
      expect(screen.getByRole('combobox', { name: 'app.types.all' }))!.toBeInTheDocument()
    })

    it('should render app cards correctly', () => {
      renderList()

      expect(screen.getByText('Test App 1'))!.toBeInTheDocument()
      expect(screen.getByText('Test App 2'))!.toBeInTheDocument()
    })

    it('should render with all filter options visible', () => {
      renderList()

      expect(screen.getByRole('textbox'))!.toBeInTheDocument()
      expect(screen.getByText('common.tag.placeholder'))!.toBeInTheDocument()
      expect(screen.getByText('app.showMyCreatedAppsOnly'))!.toBeInTheDocument()
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

      expect(await screen.findByRole('option', { name: 'app.types.all' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.workflow' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.advanced' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.chatbot' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.agent' }))!.toBeInTheDocument()
      expect(await screen.findByRole('option', { name: 'app.types.completion' }))!.toBeInTheDocument()
    })

    it('should update category for each app type option click', async () => {
      const appTypeTexts = [
        { mode: AppModeEnum.WORKFLOW, text: 'app.types.workflow' },
        { mode: AppModeEnum.ADVANCED_CHAT, text: 'app.types.advanced' },
        { mode: AppModeEnum.CHAT, text: 'app.types.chatbot' },
        { mode: AppModeEnum.AGENT_CHAT, text: 'app.types.agent' },
        { mode: AppModeEnum.COMPLETION, text: 'app.types.completion' },
      ]

      for (const { mode, text } of appTypeTexts) {
        const user = userEvent.setup()
        const { unmount } = renderList()
        await openAppTypeSelect(user)
        mockSetCategory.mockClear()
        await user.click(await screen.findByRole('option', { name: text }))
        expect(mockSetCategory).toHaveBeenCalledWith(mode)
        unmount()
      }
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

  describe('Footer Visibility', () => {
    it('should render footer when branding is disabled', () => {
      renderList()
      expect(screen.getByTestId('footer'))!.toBeInTheDocument()
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
      expect(container)!.toBeInTheDocument()
    })
  })
})
