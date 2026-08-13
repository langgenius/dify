import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { keepPreviousData } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import * as React from 'react'
import { stepByStepTourSessionAtom } from '@/app/components/step-by-step-tour/state'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'
import { List } from '../list'

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
const mockUseWorkflowOnlineUsers = vi.hoisted(() =>
  vi.fn((_options: unknown) => ({
    onlineUsersMap: {},
  })),
)
let stepByStepTourSessionState: StepByStepTourSessionState = {}

const mockLearnDifyApp = vi.hoisted(
  () =>
    ({
      app_id: 'learn-dify-template',
      app: {
        id: 'learn-dify-template-source',
        mode: 'chat',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#fff',
        icon_url: '',
        name: 'Learn Dify Template',
        description: 'Learn how to build with Dify',
        use_icon_as_answer_icon: false,
      },
      description: 'Learn how to build with Dify',
      copyright: '',
      privacy_policy: null,
      custom_disclaimer: null,
      categories: ['Assistant'],
      position: 1,
      is_listed: true,
      install_count: 0,
      installed: false,
      editable: false,
      is_agent: false,
      can_trial: true,
    }) satisfies App,
)

let mockSearchParams = new URLSearchParams('')
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
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
    account: {
      profile: {
        get: {
          queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
        },
      },
    },
    apps: {
      get: {
        key: () => ['console', 'apps', 'get'],
        infiniteOptions: (options: unknown) => mockAppListInfiniteOptions(options),
      },
      starred: {
        get: {
          key: () => ['console', 'apps', 'starred', 'get'],
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
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ['console', 'systemFeatures', 'get'],
          ...options,
        }),
      },
    },
  },
}))

let mockWorkspacePermissionKeys = ['app.create_and_management']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'creator-1' },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
const mockOnPlanInfoChanged = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
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
  TagFilter: ({
    value,
    onChange,
    onOpenTagManagement,
  }: {
    value: string[]
    onChange: (value: string[]) => void
    onOpenTagManagement: () => void
  }) => (
    <div>
      <button type="button" onClick={() => onChange(['tag-1'])}>
        common.tag.placeholder
      </button>
      <span data-testid="tag-filter-value">{value.join(',')}</span>
      <button type="button" onClick={onOpenTagManagement}>
        Manage tags
      </button>
    </div>
  ),
}))

vi.mock('../hooks/use-workflow-online-users', () => ({
  useWorkflowOnlineUsers: (options: unknown) => mockUseWorkflowOnlineUsers(options),
}))

const mockFetchNextPage = vi.fn()
let mockSystemFeatures: GetSystemFeaturesResponse | null = null

const mockServiceState = {
  error: null as Error | null,
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetching: false,
  isLoading: false,
  isFetchingNextPage: false,
  isPlaceholderData: false,
}
let mockStarredIsLoading = false
let mockStarredError: Error | null = null

const defaultAppData = {
  pages: [
    {
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
    },
  ],
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
    useQuery: (options: { input?: unknown }) =>
      options.input
        ? {
            data: mockStarredIsLoading ? undefined : mockStarredAppData,
            error: mockStarredError,
          }
        : {
            data: mockSystemFeatures,
            error: null,
          },
    useSuspenseQuery: () => ({ data: mockSystemFeatures }),
    useInfiniteQuery: () => ({
      data: mockServiceState.isLoading ? undefined : mockAppData,
      isFetching: mockServiceState.isFetching,
      isFetchNextPageError: mockServiceState.isFetchNextPageError,
      isFetchingNextPage: mockServiceState.isFetchingNextPage,
      isPlaceholderData: mockServiceState.isPlaceholderData,
      fetchNextPage: mockFetchNextPage,
      hasNextPage: mockServiceState.hasNextPage,
      error: mockServiceState.error,
    }),
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
      return function MockCreateFromDSLModal({
        show,
        onClose,
        onSuccess,
      }: {
        show: boolean
        onClose: () => void
        onSuccess: () => void
      }) {
        if (!show) return null
        return React.createElement(
          'div',
          { 'data-testid': 'create-dsl-modal' },
          React.createElement(
            'button',
            { onClick: onClose, 'data-testid': 'close-dsl-modal' },
            'Close',
          ),
          React.createElement(
            'button',
            { onClick: onSuccess, 'data-testid': 'success-dsl-modal' },
            'Success',
          ),
        )
      }
    }
    if (fnString.includes('create-app-modal')) {
      return function MockCreateAppModal({
        show,
        onClose,
        onSuccess,
        onCreateFromTemplate,
      }: {
        show: boolean
        onClose: () => void
        onSuccess: () => void
        onCreateFromTemplate: () => void
      }) {
        if (!show) return null
        return React.createElement(
          'div',
          { 'data-testid': 'create-app-modal' },
          React.createElement(
            'button',
            { onClick: onClose, 'data-testid': 'close-create-modal' },
            'Close',
          ),
          React.createElement(
            'button',
            { onClick: onSuccess, 'data-testid': 'success-create-modal' },
            'Success',
          ),
          React.createElement(
            'button',
            { onClick: onCreateFromTemplate, 'data-testid': 'to-template-modal' },
            'To Template',
          ),
        )
      }
    }
    if (fnString.includes('create-app-dialog')) {
      return function MockCreateAppTemplateDialog({
        show,
        onClose,
        onSuccess,
        onCreateFromBlank,
      }: {
        show: boolean
        onClose: () => void
        onSuccess: () => void
        onCreateFromBlank: () => void
      }) {
        if (!show) return null
        return React.createElement(
          'div',
          { 'data-testid': 'template-dialog' },
          React.createElement(
            'button',
            { onClick: onClose, 'data-testid': 'close-template-dialog' },
            'Close',
          ),
          React.createElement(
            'button',
            { onClick: onSuccess, 'data-testid': 'success-template-dialog' },
            'Success',
          ),
          React.createElement(
            'button',
            { onClick: onCreateFromBlank, 'data-testid': 'to-blank-modal' },
            'To Blank',
          ),
        )
      }
    }
    return () => null
  },
}))

vi.mock('../app-card', () => ({
  AppCard: ({
    app,
    stepByStepTourActionMenuOpen,
    stepByStepTourActionMenuHighlightPart,
    stepByStepTourCardTarget,
    stepByStepTourCardHighlightPart,
  }: {
    app: { id: string; name: string }
    stepByStepTourActionMenuOpen?: boolean
    stepByStepTourActionMenuHighlightPart?: string
    stepByStepTourCardTarget?: string
    stepByStepTourCardHighlightPart?: string
  }) => {
    return React.createElement(
      'div',
      {
        'data-testid': `app-card-${app.id}`,
        'data-step-by-step-tour-target': stepByStepTourCardTarget,
        'data-step-by-step-tour-highlight-part': stepByStepTourCardHighlightPart,
        role: 'article',
      },
      app.name,
      React.createElement('button', {
        'data-testid': `app-card-action-bar-${app.id}`,
        'data-step-by-step-tour-highlight-part': stepByStepTourActionMenuHighlightPart,
        'data-step-by-step-tour-menu-open': String(Boolean(stepByStepTourActionMenuOpen)),
        type: 'button',
      }),
    )
  },
  default: ({ app }: { app: { id: string; name: string } }) => {
    return React.createElement(
      'div',
      { 'data-testid': `app-card-${app.id}`, role: 'article' },
      app.name,
    )
  },
}))

vi.mock('../app-card/action-bar', () => ({
  AppCardActionBar: ({ app }: { app: { id: string; name: string } }) => {
    return React.createElement('button', {
      'aria-label': `Actions for ${app.name}`,
      type: 'button',
    })
  },
}))

vi.mock('../empty', () => ({
  default: ({ stepByStepTourTarget }: { stepByStepTourTarget?: string }) => {
    return React.createElement(
      'div',
      {
        'data-testid': 'empty-state',
        'data-step-by-step-tour-target': stepByStepTourTarget,
        role: 'status',
      },
      'No apps found',
    )
  },
}))

vi.mock('@/app/components/explore/learn-dify', () => ({
  default: ({
    title,
    onCreate,
    onTry,
  }: {
    title?: string
    onCreate?: (app: App) => void
    onTry?: (params: TryAppSelection) => void
  }) =>
    React.createElement(
      'section',
      null,
      title,
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onTry?.({ appId: mockLearnDifyApp.app_id, app: mockLearnDifyApp }),
        },
        'Preview Learn Dify template',
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: () => onCreate?.(mockLearnDifyApp) },
        'Create Learn Dify template',
      ),
    ),
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

type RenderListOptions = {
  onCreateLearnDify?: (app: App) => void
  onTryLearnDify?: (params: TryAppSelection) => void
  systemFeatures?: Partial<GetSystemFeaturesResponse>
}

const renderList = (searchParams = '', options: RenderListOptions = {}) => {
  mockSearchParams = new URLSearchParams(searchParams)
  const { wrapper: ConsoleQueryWrapper, systemFeatures } = createConsoleQueryWrapper({
    accountProfile: { id: 'creator-1' },
    systemFeatures: { branding: { enabled: false }, ...options.systemFeatures },
  })
  mockSystemFeatures = systemFeatures
  const store = createStore()
  seedRegisteredConsoleStateFixture(store)
  store.set(stepByStepTourSessionAtom, stepByStepTourSessionState)
  const rendered = renderWithNuqs(
    <ConsoleQueryWrapper>
      <JotaiProvider store={store}>
        <List
          onCreateLearnDify={options.onCreateLearnDify}
          onTryLearnDify={options.onTryLearnDify}
        />
      </JotaiProvider>
    </ConsoleQueryWrapper>,
    { searchParams },
  )
  return rendered
}

type AppListInfiniteOptions = {
  input: (pageParam: number) => { query: Record<string, unknown> }
  getNextPageParam: (lastPage: { has_more: boolean; page: number }) => number | undefined
  placeholderData?: unknown
}

type AppStarredListQueryOptions = {
  input: {
    query: Record<string, unknown>
  }
  placeholderData?: unknown
}

const openAppTypeSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('button', { name: /^(Types|app\.types\.)/ }))
  return user
}

const openAppSortSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('button', { name: 'Sort by Last modified' }))
  return user
}

const dropDSLFileOnStudioHeader = (file: File) => {
  fireEvent.drop(screen.getByRole('button', { name: 'common.operation.create' }), {
    dataTransfer: {
      files: [file],
      types: ['Files'],
    },
  })
}

const setActiveStudioStepByStepTour = (
  activeGuideIndex: number,
  activeGuideGroup:
    | 'studioWithApps'
    | 'studioNoCreateEmpty'
    | 'studioNoCreateWithApps'
    | undefined = 'studioWithApps',
) => {
  stepByStepTourSessionState = {
    activeTaskId: 'studio',
    activeGuideGroup,
    activeGuideIndex,
  }
}

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stepByStepTourSessionState = {}
    mockWorkspacePermissionKeys = ['app.create_and_management']
    mockServiceState.error = null
    mockServiceState.hasNextPage = false
    mockServiceState.isFetchNextPageError = false
    mockServiceState.isFetching = false
    mockServiceState.isLoading = false
    mockServiceState.isFetchingNextPage = false
    mockServiceState.isPlaceholderData = false
    mockStarredIsLoading = false
    mockStarredError = null
    mockAppData = defaultAppData
    mockStarredAppData = {
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      has_more: false,
    }
    mockUseWorkflowOnlineUsers.mockClear()
    intersectionCallbacks.length = 0
  })

  describe('Rendering', () => {
    it('should open the create menu before the Studio with-apps guide group is persisted', async () => {
      setActiveStudioStepByStepTour(0, undefined)

      renderList()

      expect(screen.getByRole('button', { name: 'common.operation.create' })).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate,
      )
      expect(await screen.findByText('app.newApp.startFromBlank')).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank', hidden: true }),
      ).toBeInTheDocument()
      const createMenuHighlightPart = document.body.querySelector(
        '[data-step-by-step-tour-highlight-part]',
      )
      expect(createMenuHighlightPart).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu,
      )
      expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
    })

    it('should render filters and search before the right aligned actions', () => {
      renderList()

      const creatorsButton = screen.getByRole('button', { name: 'Creators' })
      const searchInput = screen.getByRole('searchbox', {
        name: 'app.gotoAnything.actions.searchApplications',
      })
      const sortButton = screen.getByRole('button', { name: 'Sort by Last modified' })
      const snippetsLink = screen.getByRole('link', { name: 'app.studio.viewSnippets' })
      const createButton = screen.getByRole('button', { name: 'common.operation.create' })

      expect(snippetsLink).toHaveAttribute('href', '/snippets')
      expect(
        creatorsButton.compareDocumentPosition(sortButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        sortButton.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        searchInput.compareDocumentPosition(snippetsLink) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        snippetsLink.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('should render app cards when apps exist', () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2'))!.toBeInTheDocument()
    })

    it('should hide starred section when there are no starred apps', () => {
      renderList()

      expect(screen.queryByText('Starred')).not.toBeInTheDocument()
      expect(screen.queryByText('All Apps')).not.toBeInTheDocument()
    })

    it('should render starred apps before all app cards when starred apps exist', () => {
      mockStarredAppData = {
        data: [
          {
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
          },
        ],
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
      const actionBar = screen.getByRole('button', { name: 'Actions for Starred App' })

      expect(starredCard).toBeInTheDocument()
      expect(actionBar).toBeInTheDocument()
      expect(
        starredLabel.compareDocumentPosition(starredCard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        starredCard.compareDocumentPosition(allAppsLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        allAppsLabel.compareDocumentPosition(firstAppCard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()

      expect(actionBar).toBeEnabled()
    })

    it('should expose the first workspace app card and open its action menu for the Studio with-apps tour manage guide', () => {
      setActiveStudioStepByStepTour(1)
      mockStarredAppData = {
        data: [
          {
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
          },
        ],
        total: 1,
        page: 1,
        limit: 100,
        has_more: false,
      }

      renderList()

      const firstWorkspaceCard = screen.getByTestId('app-card-app-1')
      const firstWorkspaceActionBar = screen.getByTestId('app-card-action-bar-app-1')
      const starredCard = screen.getByRole('link', { name: /Starred App/ })
      const starredActionBar = screen.getByRole('button', {
        name: 'Actions for Starred App',
      })

      expect(firstWorkspaceCard).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard,
      )
      expect(firstWorkspaceActionBar).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu,
      )
      expect(firstWorkspaceActionBar).toHaveAttribute('data-step-by-step-tour-menu-open', 'true')
      expect(
        screen.queryByRole('menuitem', { name: 'app.newApp.startFromBlank' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'app.newApp.startFromTemplate' }),
      ).not.toBeInTheDocument()
      expect(starredCard).not.toHaveAttribute('data-step-by-step-tour-target')
      expect(starredActionBar).not.toHaveAttribute('data-step-by-step-tour-highlight-part')
    })

    it('should highlight the first starred app row for the Studio no-create with-apps tour', () => {
      mockWorkspacePermissionKeys = []
      setActiveStudioStepByStepTour(0, 'studioNoCreateWithApps')
      mockStarredAppData = {
        data: [
          {
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
          },
        ],
        total: 1,
        page: 1,
        limit: 100,
        has_more: false,
      }

      renderList()

      const starredCard = screen.getByRole('link', { name: /Starred App/ })
      const firstWorkspaceCard = screen.getByTestId('app-card-app-1')
      const firstWorkspaceActionBar = screen.getByTestId('app-card-action-bar-app-1')

      expect(starredCard).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard,
      )
      expect(starredCard).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard,
      )
      expect(firstWorkspaceCard).not.toHaveAttribute('data-step-by-step-tour-target')
      expect(firstWorkspaceCard).not.toHaveAttribute('data-step-by-step-tour-highlight-part')
      expect(firstWorkspaceActionBar).toHaveAttribute('data-step-by-step-tour-menu-open', 'false')
    })

    it('should highlight the first all-apps row for the Studio no-create with-apps tour when there are no starred apps', () => {
      mockWorkspacePermissionKeys = []
      setActiveStudioStepByStepTour(0, 'studioNoCreateWithApps')

      renderList()

      const firstWorkspaceCard = screen.getByTestId('app-card-app-1')
      const secondWorkspaceCard = screen.getByTestId('app-card-app-2')
      const firstWorkspaceActionBar = screen.getByTestId('app-card-action-bar-app-1')

      expect(firstWorkspaceCard).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard,
      )
      expect(firstWorkspaceCard).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard,
      )
      expect(secondWorkspaceCard).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard,
      )
      expect(firstWorkspaceActionBar).not.toHaveAttribute('data-step-by-step-tour-highlight-part')
      expect(firstWorkspaceActionBar).toHaveAttribute('data-step-by-step-tour-menu-open', 'false')
    })

    it('should expose the regular empty state for the Studio no-create empty tour', () => {
      mockWorkspacePermissionKeys = []
      mockAppData = { pages: [{ data: [], total: 0 }] }
      setActiveStudioStepByStepTour(0, 'studioNoCreateEmpty')

      renderList()

      const target = document.querySelector(
        getStepByStepTourTargetSelector(STEP_BY_STEP_TOUR_TARGETS.studioNoCreateEmpty),
      )

      expect(target).toBeInTheDocument()
      expect(target).toBe(screen.getByTestId('empty-state'))
      expect(target).not.toHaveClass('absolute', 'top-1/2', 'left-1/2')
      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.create' }),
      ).not.toBeInTheDocument()
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
      expect(
        screen.getByRole('button', { name: /app\.newApp\.startFromTemplate/ }),
      ).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate,
      )
      expect(screen.getByRole('button', { name: /app\.newApp\.startFromBlank/ })).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioEmptyBlank,
      )
      expect(screen.getByRole('button', { name: /app\.importDSL/ })).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL,
      )
      expect(
        screen
          .getByText('app.firstEmpty.learnDifyTitle')
          .closest('[data-step-by-step-tour-target]'),
      ).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify,
      )
    })

    it('should lay out first empty state placeholder cards with auto-fill grid columns', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      const { container } = renderList()
      const placeholderGrid = Array.from(container.querySelectorAll('.pointer-events-none')).find(
        (element) => element.className.includes('grid-rows-4'),
      )

      if (!placeholderGrid) throw new Error('Expected first empty state placeholder grid to render')

      expect(placeholderGrid).toHaveClass(
        'grid',
        'grid-cols-[repeat(auto-fill,minmax(296px,1fr))]',
        'grid-rows-4',
      )
      expect(placeholderGrid).not.toHaveClass(
        'grid-cols-1',
        'sm:grid-cols-2',
        'lg:grid-cols-3',
        'xl:grid-cols-4',
      )
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

    it('should not render first empty state from placeholder data during a filter transition', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }
      mockServiceState.isPlaceholderData = true

      renderList()

      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
    })

    it('should keep the regular empty state for empty filtered results', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList('?keywords=missing+app')

      expect(screen.getByTestId('empty-state'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Types' }))!.toBeInTheDocument()
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
    })

    it('should leave the first empty state as soon as a filter changes', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }
      renderList()

      expect(screen.getByText('app.firstEmpty.title')).toBeInTheDocument()

      fireEvent.change(
        screen.getByRole('searchbox', {
          name: 'app.gotoAnything.actions.searchApplications',
        }),
        { target: { value: 'workflow' } },
      )

      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
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

    it('should forward Learn Dify template interactions', async () => {
      const user = userEvent.setup()
      const onCreateLearnDify = vi.fn()
      const onTryLearnDify = vi.fn()
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList('', {
        onCreateLearnDify,
        onTryLearnDify,
        systemFeatures: { enable_learn_app: true },
      })

      await user.click(screen.getByRole('button', { name: 'Preview Learn Dify template' }))
      expect(onTryLearnDify).toHaveBeenCalledWith({
        appId: mockLearnDifyApp.app_id,
        app: mockLearnDifyApp,
      })

      await user.click(screen.getByRole('button', { name: 'Create Learn Dify template' }))
      expect(onCreateLearnDify).toHaveBeenCalledWith(mockLearnDifyApp)
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
      renderList('?category=workflow')

      expect(screen.getByRole('button', { name: 'app.types.workflow' }))!.toBeInTheDocument()
    })

    it('should reject API modes that the Studio category control does not support', () => {
      renderList('?category=channel')

      expect(screen.getByRole('button', { name: 'Types' })).toBeInTheDocument()
      const options = mockAppListInfiniteOptions.mock.calls.at(-1)?.[0] as AppListInfiniteOptions
      expect(options.input(1).query).not.toHaveProperty('mode')
    })

    it('should update category when workflow option is selected', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList()
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('menuitemradio', { name: 'app.types.workflow' }))

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('category')).toBe(
        AppModeEnum.WORKFLOW,
      )
    })

    it('should update category when all option is selected', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList('?category=workflow')
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('menuitemradio', { name: 'All' }))

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('category')).toBe(false)
    })
  })

  describe('Search Functionality', () => {
    it('should clear the keywords URL state', async () => {
      const { onUrlUpdate } = renderList('?keywords=existing+search')

      const clearButton = document.querySelector('.i-ri-close-circle-fill')?.closest('button')
      expect(clearButton)!.toBeInTheDocument()
      if (clearButton) fireEvent.click(clearButton)

      expect(screen.getByRole('searchbox')).toHaveValue('')
      await waitFor(() => {
        expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('keywords')).toBe(false)
      })
    })
  })

  describe('App List Query', () => {
    it('resets the catalog scroll position before switching datasets', () => {
      renderList()
      const searchBox = screen.getByRole('searchbox', {
        name: 'app.gotoAnything.actions.searchApplications',
      })
      const scrollContainer = screen.getByRole('region', { name: 'common.menus.apps' })
      expect(scrollContainer).not.toContainElement(searchBox)
      const scrollTo = vi.fn()
      scrollContainer.scrollTo = scrollTo

      fireEvent.click(screen.getByText('common.tag.placeholder'))

      expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    })

    it('should build paged query input from active filters', () => {
      renderList('?keywords=sales&category=workflow')
      fireEvent.click(screen.getByRole('button', { name: 'Creators' }))
      fireEvent.click(screen.getByText('Alice'))
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
      renderList('?keywords=sales&category=workflow')
      fireEvent.click(screen.getByRole('button', { name: 'Creators' }))
      fireEvent.click(screen.getByText('Alice'))
      fireEvent.click(screen.getByText('common.tag.placeholder'))

      const options = mockAppStarredListQueryOptions.mock.calls.at(
        -1,
      )?.[0] as AppStarredListQueryOptions

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

    it('should keep previous main and starred data visible while filters refetch', async () => {
      renderList()

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()

      fireEvent.click(screen.getByText('common.tag.placeholder'))

      await waitFor(() => {
        const options = mockAppListInfiniteOptions.mock.calls.at(-1)?.[0] as AppListInfiniteOptions
        expect(options.input(1).query).toMatchObject({ tag_ids: ['tag-1'] })
        expect(options.placeholderData).toBe(keepPreviousData)
      })
      const starredOptions = mockAppStarredListQueryOptions.mock.calls.at(
        -1,
      )?.[0] as AppStarredListQueryOptions
      expect(starredOptions.placeholderData).toBe(keepPreviousData)
      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
    })
  })

  describe('Creators Filter', () => {
    it('should handle creator selection', () => {
      renderList()

      fireEvent.click(screen.getByRole('button', { name: 'Creators' }))
      fireEvent.click(screen.getByRole('button', { name: /Bob/ }))

      expect(screen.getByRole('button', { name: /Creators.*\+1/ })).toBeInTheDocument()
    })
  })

  describe('Create Menu', () => {
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

      expect(
        screen.queryByRole('button', { name: 'common.operation.create' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('App Type Select Options', () => {
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
        const { onUrlUpdate, unmount } = renderList()
        await openAppTypeSelect(user)
        await user.click(await screen.findByRole('menuitemradio', { name: text }))
        await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
        expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('category')).toBe(mode)
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

  describe('DSL File Drop', () => {
    it('should handle DSL file drop and show modal', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      dropDSLFileOnStudioHeader(mockFile)

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()
    })

    it('should close DSL modal when onClose is called', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      dropDSLFileOnStudioHeader(mockFile)

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-dsl-modal'))

      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
    })

    it('should close DSL modal when its mutation reports success', () => {
      renderList()

      const mockFile = new File(['test content'], 'test.yml', { type: 'application/yaml' })
      dropDSLFileOnStudioHeader(mockFile)

      expect(screen.getByTestId('create-dsl-modal'))!.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('success-dsl-modal'))

      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
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

    it('should show one catalog skeleton until both app queries have data', () => {
      mockServiceState.hasNextPage = true
      mockServiceState.isLoading = true
      const mainPending = renderList()

      expect(
        screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' }),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
      expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument()
      expect(mockFetchNextPage).not.toHaveBeenCalled()

      mainPending.unmount()
      mockServiceState.isLoading = false
      mockStarredIsLoading = true
      renderList()

      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
      expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should keep the main catalog available when the starred request fails', () => {
      mockStarredIsLoading = true
      mockStarredError = new Error('Starred request failed')

      renderList()

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.queryByText('Starred')).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('should keep resolved data visible and retry a failed next page', async () => {
      const user = userEvent.setup()
      mockServiceState.error = new Error('Test error')
      mockServiceState.hasNextPage = true
      mockServiceState.isFetchNextPageError = true

      renderList()

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })
      await user.click(retryButton)

      expect(mockFetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false })
    })
  })
})
