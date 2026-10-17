import type { AppPagination } from '@dify/contracts/api/console/apps/types.gen'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import * as React from 'react'
import { stepByStepTourSessionAtom } from '@/app/components/step-by-step-tour/state'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { createDeferred } from '@/test/deferred'
import { List } from '../list'
import { appListQueryParsers } from '../query-params'

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
    'app.studio.availability.all': 'All',
    'app.studio.availability.available': 'Available',
    'app.studio.availability.unavailable': 'Unavailable',
    'app.studio.availability.status': 'Status',
  })
})

const { getApps, getStarredApps } = vi.hoisted(() => ({
  getApps: vi.fn(),
  getStarredApps: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': getApps,
      'apps.starred.get': getStarredApps,
    }),
  }
})
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
      },
      description: 'Learn how to build with Dify',
      copyright: '',
      privacy_policy: null,
      custom_disclaimer: null,
      categories: ['Assistant'],
      position: 1,
      is_listed: true,
      can_trial: true,
    }) satisfies RecommendedAppResponse,
)

let mockSearchParams = new URLSearchParams('')
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/apps',
  useSearchParams: () => mockSearchParams,
}))

let mockWorkspacePermissionKeys = ['app.create_and_management']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'creator-1' },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

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

let hasMoreApps = false
let seedAppList = true
let seedStarredList = true

const defaultAppData: { pages: Array<Pick<AppPagination, 'data' | 'total'>> } = {
  pages: [
    {
      data: [
        {
          id: 'app-1',
          name: 'Test App 1',
          description: 'Description 1',
          mode: 'chat',
          icon_url: null,
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
          mode: 'workflow',
          icon_url: null,
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

let mockStarredAppData: AppPagination = {
  data: [],
  total: 0,
  page: 1,
  limit: 100,
  has_more: false,
}

vi.mock('@/hooks/use-pay', () => ({
  CheckResultToast: () => null,
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
      return function MockCreateFromDSLModal({
        show,
        onClose,
      }: {
        show: boolean
        onClose: () => void
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
            { onClick: onClose, 'data-testid': 'success-dsl-modal' },
            'Success',
          ),
        )
      }
    }
    if (fnString.includes('create-app-modal')) {
      return function MockCreateAppModal({
        show,
        onClose,
        onCreateFromTemplate,
      }: {
        show: boolean
        onClose: () => void
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
            { onClick: onClose, 'data-testid': 'success-create-modal' },
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
        onCreateFromBlank,
      }: {
        show: boolean
        onClose: () => void
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
            { onClick: onClose, 'data-testid': 'success-template-dialog' },
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
      'li',
      {
        'data-testid': `app-card-${app.id}`,
        'data-step-by-step-tour-target': stepByStepTourCardTarget,
        'data-step-by-step-tour-highlight-part': stepByStepTourCardHighlightPart,
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
    return React.createElement('li', { 'data-testid': `app-card-${app.id}` }, app.name)
  },
}))

vi.mock('../app-card/interactions', () => ({
  AppCardInteractions: ({
    app,
    children,
  }: {
    app: { id: string; name: string }
    children: React.ReactElement
  }) => {
    return React.createElement(
      React.Fragment,
      null,
      children,
      React.createElement('button', {
        'aria-label': `Actions for ${app.name}`,
        type: 'button',
      }),
    )
  },
}))

vi.mock('../empty', () => ({
  default: ({ stepByStepTourTarget }: { stepByStepTourTarget?: string }) => {
    return React.createElement(
      'div',
      {
        'data-testid': 'empty-state',
        'data-step-by-step-tour-target': stepByStepTourTarget,
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
    onCreate?: (app: RecommendedAppResponse) => void
    onTry?: (app: RecommendedAppResponse) => void
  }) =>
    React.createElement(
      'section',
      null,
      title,
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onTry?.(mockLearnDifyApp),
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
  onCreateLearnDify?: (app: RecommendedAppResponse) => void
  onTryLearnDify?: (app: RecommendedAppResponse) => void
  systemFeatures?: Partial<GetSystemFeaturesResponse>
}

const renderList = (searchParams = '', options: RenderListOptions = {}) => {
  mockSearchParams = new URLSearchParams(searchParams)
  const { wrapper: ConsoleQueryWrapper, queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'creator-1' },
    systemFeatures: { branding: { enabled: false }, ...options.systemFeatures },
  })
  const category =
    appListQueryParsers.category.parse(mockSearchParams.get('category') ?? '') ?? 'all'
  const availability =
    appListQueryParsers.availability.parse(mockSearchParams.get('availability') ?? '') ?? 'all'
  const query = {
    name: mockSearchParams.get('keywords') ?? '',
    page: 1,
    limit: 30,
    sort_by:
      appListQueryParsers.sort_by.parse(mockSearchParams.get('sort_by') ?? '') ?? 'last_modified',
    ...(category !== 'all' ? { mode: category } : {}),
    ...(availability !== 'all' ? { availability } : {}),
  }
  const appOptions = consoleQuery.apps.get.infiniteOptions({
    input: (page: number) => ({ query: { ...query, page } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  })
  if (seedAppList && mockAppData.pages.length)
    queryClient.setQueryData<{ pages: AppPagination[]; pageParams: number[] }>(
      appOptions.queryKey,
      {
        pages: mockAppData.pages.map((page, index) => ({
          ...page,
          page: index + 1,
          limit: 30,
          has_more: hasMoreApps,
        })),
        pageParams: [1],
      },
    )
  if (seedStarredList)
    queryClient.setQueryData<AppPagination>(
      consoleQuery.apps.starred.get.queryKey({ input: { query: { ...query, limit: 100 } } }),
      mockStarredAppData,
    )
  queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
    accounts: [
      {
        id: 'creator-1',
        name: 'Alice',
        avatar_url: null,
        status: 'active',
        email: 'alice@example.com',
        role: 'admin',
      },
      {
        id: 'creator-2',
        name: 'Bob',
        avatar_url: null,
        status: 'active',
        email: 'bob@example.com',
        role: 'normal',
      },
    ],
  })
  const store = createStore()
  seedRegisteredConsoleStateFixture(store)
  store.set(stepByStepTourSessionAtom, stepByStepTourSessionState)
  const onUrlUpdate = vi.fn()
  const rendered = render(
    <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <ConsoleQueryWrapper>
        <JotaiProvider store={store}>
          <List
            onCreateLearnDify={options.onCreateLearnDify}
            onTryLearnDify={options.onTryLearnDify}
          />
        </JotaiProvider>
      </ConsoleQueryWrapper>
    </NuqsTestingAdapter>,
  )
  return { ...rendered, onUrlUpdate, queryClient }
}

const openAppTypeSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('combobox', { name: 'Types' }))
  return user
}

const openAppSortSelect = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('combobox', { name: 'Sort by' }))
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
    hasMoreApps = false
    seedAppList = true
    seedStarredList = true
    getApps.mockReset().mockImplementation(() => new Promise(() => {}))
    getStarredApps.mockReset().mockImplementation(() => new Promise(() => {}))
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

      const creatorsButton = screen.getByRole('combobox', { name: 'Creators' })
      const searchInput = screen.getByRole('searchbox', {
        name: 'app.gotoAnything.actions.searchApplications',
      })
      const sortButton = screen.getByRole('combobox', { name: 'Sort by' })
      const snippetsLink = screen.getByRole('link', { name: 'app.studio.viewSnippets' })
      const createButton = screen.getByRole('button', { name: 'common.operation.create' })

      expect(snippetsLink).toHaveAttribute('href', '/snippets')
      expect(sortButton).toHaveTextContent('Sort by Last modified')
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
            mode: 'chat',
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

      const starredLabel = screen.getByRole('heading', { level: 2, name: 'Starred' })
      const starredList = screen.getByRole('list', { name: 'Starred' })
      const starredCard = screen.getByRole('link', { name: 'Starred App' })
      const allAppsLabel = screen.getByRole('heading', { level: 2, name: 'All Apps' })
      const allAppsList = screen.getByRole('list', { name: 'All Apps' })
      const firstAppCard = screen.getByTestId('app-card-app-1')
      const actionBar = screen.getByRole('button', { name: 'Actions for Starred App' })

      expect(starredCard).toBeInTheDocument()
      expect(actionBar).toBeInTheDocument()
      expect(screen.getAllByRole('list')).toHaveLength(2)
      expect(starredList).toContainElement(starredCard)
      expect(within(starredList).getAllByRole('listitem')).toHaveLength(1)
      expect(firstAppCard.parentElement).toBe(allAppsList)
      expect(within(allAppsList).getAllByRole('listitem')).toHaveLength(2)
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
            mode: 'chat',
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
      const starredCard = screen.getByRole('link', { name: 'Starred App' })
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
            mode: 'chat',
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

      const starredCard = screen.getByRole('link', { name: 'Starred App' })
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
      expect(
        screen.queryByRole('region', { name: 'app.newApp.dropDSLToCreateApp' }),
      ).not.toBeInTheDocument()
    })

    it('should render first empty state when there are no apps and no active filters', () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }

      renderList('', { systemFeatures: { enable_learn_app: true } })

      expect(screen.getByText('app.firstEmpty.title'))!.toBeInTheDocument()
      expect(screen.getByText('app.firstEmpty.learnDifyTitle'))!.toBeInTheDocument()
      expect(screen.getByText('app.firstEmpty.or'))!.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Types' }))!.toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: /app\.importApp/ })).toHaveAttribute(
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
      expect(screen.getByRole('combobox', { name: 'Types' }))!.toBeInTheDocument()
    })

    it('should keep the regular empty state for empty filtered results', async () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }
      getApps.mockResolvedValue({ data: [], total: 0, page: 1, limit: 30, has_more: false })

      renderList('?keywords=missing+app')

      expect(screen.getByTestId('empty-state'))!.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.filterEmpty.noApps')
      expect(screen.getByRole('status')).toHaveClass('sr-only')
      await waitFor(() =>
        expect(screen.getByTestId('empty-state').closest('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false',
        ),
      )
      expect(screen.getByRole('combobox', { name: 'Types' }))!.toBeInTheDocument()
      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
      expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
    })

    it('keeps the settled empty status during a real background refresh', async () => {
      mockAppData = { pages: [{ data: [], total: 0 }] }
      getApps
        .mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 30, has_more: false })
        .mockImplementationOnce(() => new Promise(() => {}))
      const { queryClient } = renderList('?keywords=missing+app')
      await waitFor(() =>
        expect(screen.getByTestId('empty-state').closest('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false',
        ),
      )
      act(() => {
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      })
      await waitFor(() => expect(getApps).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('status')).toHaveTextContent('app.filterEmpty.noApps')
      expect(screen.getByTestId('empty-state').closest('[aria-busy]')).toHaveAttribute(
        'aria-busy',
        'true',
      )
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

      fireEvent.click(screen.getByRole('button', { name: /app\.importApp/ }))
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
      expect(onTryLearnDify).toHaveBeenCalledWith(mockLearnDifyApp)

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

      expect(screen.getByRole('combobox', { name: 'Types' })).toHaveTextContent(
        'app.types.workflow',
      )
    })

    it('should reject API modes that the Studio category control does not support', async () => {
      seedAppList = false
      renderList('?category=channel')

      expect(screen.getByRole('combobox', { name: 'Types' })).toBeInTheDocument()
      await waitFor(() => expect(getApps).toHaveBeenCalledOnce())
      expect(getApps.mock.calls[0]![0].query).not.toHaveProperty('mode')
    })

    it('should update category when workflow option is selected', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList()
      await openAppTypeSelect(user)

      await user.click(await screen.findByRole('option', { name: 'app.types.workflow' }))

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('category')).toBe('workflow')
    })

    it('should update category when all option is selected', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList('?category=workflow')
      await openAppTypeSelect(user)

      expect(await screen.findByRole('option', { name: 'app.types.workflow' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await user.click(screen.getByRole('option', { name: 'All' }))

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('category')).toBe(false)
      expect(screen.getByRole('combobox', { name: 'Types' })).toHaveTextContent('Types')
    })
  })

  describe('Search Functionality', () => {
    it('should clear the keywords URL state', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList('?keywords=existing+search')

      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

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
      const scrollContainer = screen.getByRole('region', { name: 'navigation.menus.apps' })
      expect(scrollContainer).not.toContainElement(searchBox)
      const scrollTo = vi.fn()
      scrollContainer.scrollTo = scrollTo

      fireEvent.click(screen.getByText('common.tag.placeholder'))

      expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    })

    it('should filter availability in both lists, preserve URL filters, and reset scrolling', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList('?category=workflow&keywords=sales')
      const viewport = screen.getByRole('region', { name: 'navigation.menus.apps' })
      const scrollTo = vi.fn()
      viewport.scrollTo = scrollTo
      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      await user.click(screen.getByRole('option', { name: 'Unavailable' }))
      const filters = {
        page: 1,
        availability: 'unavailable',
        mode: 'workflow',
        name: 'sales',
        sort_by: 'last_modified',
      }
      await waitFor(() =>
        expect(getApps).toHaveBeenLastCalledWith({ query: { ...filters, limit: 30 } }),
      )
      expect(getStarredApps).toHaveBeenLastCalledWith({ query: { ...filters, limit: 100 } })
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
      await waitFor(() => {
        const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams
        expect(params?.get('availability')).toBe('unavailable')
        expect(params?.get('category')).toBe('workflow')
        expect(params?.get('keywords')).toBe('sales')
      })
      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      await user.click(screen.getByRole('option', { name: 'All' }))
      await waitFor(() =>
        expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('availability')).toBe(false),
      )
    })

    it.each([
      ['available', 'Available', 'available'],
      ['unavailable', 'Unavailable', 'unavailable'],
      ['invalid', 'All', undefined],
    ])(
      'should restore and validate availability from the URL: %s',
      async (query, label, expected) => {
        seedAppList = false
        seedStarredList = false
        renderList(`?availability=${query}`)
        expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent(label)
        await waitFor(() => expect(getApps).toHaveBeenCalled())
        await waitFor(() => expect(getStarredApps).toHaveBeenCalled())
        expect(getApps.mock.calls.at(-1)?.[0].query.availability).toBe(expected)
        expect(getStarredApps.mock.calls.at(-1)?.[0].query.availability).toBe(expected)
      },
    )

    it('requests main and starred results with current filters and their own page limits', async () => {
      const user = userEvent.setup()
      renderList('?keywords=sales&category=workflow')
      await user.click(screen.getByRole('combobox', { name: 'Creators' }))
      await user.click(screen.getByRole('option', { name: /Alice/ }))
      await user.click(screen.getByText('common.tag.placeholder'))
      const filters = {
        page: 1,
        name: 'sales',
        sort_by: 'last_modified',
        tag_ids: ['tag-1'],
        creator_ids: ['creator-1'],
        mode: 'workflow',
      }
      await waitFor(() =>
        expect(getApps).toHaveBeenLastCalledWith({ query: { ...filters, limit: 30 } }),
      )
      expect(getStarredApps).toHaveBeenLastCalledWith({ query: { ...filters, limit: 100 } })
    })

    it('keeps main and starred results while new filters load, then replaces them', async () => {
      mockStarredAppData = {
        ...mockStarredAppData,
        data: [{ ...defaultAppData.pages[0]!.data[0]!, id: 'starred-app', name: 'Starred app' }],
      }
      const nextApps = createDeferred<unknown>()
      const nextStarred = createDeferred<unknown>()
      getApps.mockReturnValue(nextApps.promise)
      getStarredApps.mockReturnValue(nextStarred.promise)
      renderList()
      fireEvent.click(screen.getByText('common.tag.placeholder'))
      await waitFor(() =>
        expect(getApps).toHaveBeenCalledWith({
          query: expect.objectContaining({ tag_ids: ['tag-1'] }),
        }),
      )
      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByText('Starred app')).toBeInTheDocument()
      await act(async () => {
        nextApps.resolve({ data: [], page: 1, limit: 30, total: 0, has_more: false })
        nextStarred.resolve({ data: [], page: 1, limit: 100, total: 0, has_more: false })
      })
      await waitFor(() => expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument())
      expect(screen.queryByText('Starred app')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.filterEmpty.noApps')
    })
  })

  describe('Creators Filter', () => {
    it('should show the selected creator without an overflow count', async () => {
      const user = userEvent.setup()
      renderList()

      const trigger = screen.getByRole('combobox', { name: 'Creators' })
      await user.click(trigger)
      await user.click(screen.getByRole('option', { name: /Bob/ }))

      expect(within(trigger).getByText('B')).toBeInTheDocument()
      expect(
        within(trigger).getByText('common.dynamicSelect.selected:{"count":1}'),
      ).toBeInTheDocument()
      expect(within(trigger).queryByText(/^\+\d+$/)).not.toBeInTheDocument()
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
      fireEvent.click(await screen.findByText('app.importApp'))

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
        { mode: 'workflow' as const, text: 'app.types.workflow' },
        { mode: 'advanced-chat' as const, text: 'app.types.advanced' },
        { mode: 'chat' as const, text: 'app.types.chatbot' },
        { mode: 'agent-chat' as const, text: 'app.types.agent' },
        { mode: 'completion' as const, text: 'app.newApp.completeApp' },
      ]

      for (const { mode, text } of appTypeTexts) {
        const user = userEvent.setup()
        const { onUrlUpdate, unmount } = renderList()
        await openAppTypeSelect(user)
        await user.click(await screen.findByRole('option', { name: text }))
        await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
        expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('category')).toBe(mode)
        unmount()
      }
    })

    it.each([
      ['earliest_created', 'earliest_created', 'Earliest created'],
      ['invalid', 'last_modified', 'Last modified'],
    ])('resolves URL sort %s for the control and request', async (urlSort, expectedSort, label) => {
      seedAppList = false
      renderList(`?sort_by=${urlSort}`)
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent(label)
      await waitFor(() =>
        expect(getApps).toHaveBeenCalledWith({
          query: expect.objectContaining({ sort_by: expectedSort }),
        }),
      )
    })

    it('should update URL and query sorting while preserving filters and resetting scroll', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderList('?category=workflow&keywords=sales')
      const scrollContainer = screen.getByRole('region', { name: 'navigation.menus.apps' })
      const scrollTo = vi.fn()
      scrollContainer.scrollTo = scrollTo
      await openAppSortSelect(user)

      await user.click(await screen.findByRole('option', { name: 'Recently created' }))

      await waitFor(() =>
        expect(getApps).toHaveBeenLastCalledWith({
          query: expect.objectContaining({
            sort_by: 'recently_created',
            mode: 'workflow',
            name: 'sales',
          }),
        }),
      )
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
      await waitFor(() => {
        const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams
        expect(params?.get('sort_by')).toBe('recently_created')
        expect(params?.get('category')).toBe('workflow')
        expect(params?.get('keywords')).toBe('sales')
      })

      await openAppSortSelect(user)
      await user.click(await screen.findByRole('option', { name: 'Last modified' }))

      await waitFor(() => {
        expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('sort_by')).toBe(false)
      })
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Last modified')
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
    it('requests and appends the next page with the active availability filter', async () => {
      hasMoreApps = true
      getApps
        .mockResolvedValueOnce({
          ...defaultAppData.pages[0],
          page: 1,
          limit: 30,
          has_more: true,
        })
        .mockResolvedValue({
          data: [{ ...defaultAppData.pages[0]!.data[0]!, id: 'app-3', name: 'Third app' }],
          page: 2,
          limit: 30,
          total: 3,
          has_more: false,
        })
      renderList('?availability=unavailable')
      await waitFor(() => expect(mockObserve).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.getByTestId('app-card-app-1').closest('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false',
        ),
      )
      act(() => {
        for (const callback of [...intersectionCallbacks])
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
      })
      expect(await screen.findByTestId('app-card-app-3')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(getApps).toHaveBeenCalledWith({
        query: expect.objectContaining({ page: 2, availability: 'unavailable' }),
      })
    })

    it('should not call fetchNextPage when not intersecting', async () => {
      hasMoreApps = true
      getApps.mockResolvedValue({
        ...defaultAppData.pages[0],
        page: 1,
        limit: 30,
        has_more: true,
      })
      renderList()
      await waitFor(() => expect(mockObserve).toHaveBeenCalled())

      for (const callback of intersectionCallbacks) {
        act(() => {
          callback(
            [{ isIntersecting: false } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
        })
      }

      expect(getApps).toHaveBeenCalledOnce()
      expect(getApps).toHaveBeenCalledWith({ query: expect.objectContaining({ page: 1 }) })
    })

    it('shows one skeleton until both requests have resolved', async () => {
      seedAppList = false
      seedStarredList = false
      const main = createDeferred<unknown>()
      const starred = createDeferred<unknown>()
      getApps.mockReturnValue(main.promise)
      getStarredApps.mockReturnValue(starred.promise)
      renderList()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
      await act(async () =>
        main.resolve({ ...defaultAppData.pages[0], page: 1, limit: 30, has_more: false }),
      )
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
      expect(screen.queryByTestId('app-card-app-1')).not.toBeInTheDocument()
      await act(async () => starred.resolve(mockStarredAppData))
      expect(await screen.findByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('keeps the main catalog available when the starred request fails', async () => {
      seedStarredList = false
      getStarredApps.mockRejectedValue(new Error('Starred request failed'))
      renderList()
      expect(await screen.findByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.queryByText('Starred')).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('keeps resolved results and retries the failed next page', async () => {
      const user = userEvent.setup()
      hasMoreApps = true
      getApps
        .mockResolvedValueOnce({
          ...defaultAppData.pages[0],
          page: 1,
          limit: 30,
          has_more: true,
        })
        .mockRejectedValueOnce(new Error('Next page failed'))
        .mockResolvedValue({
          data: [{ ...defaultAppData.pages[0]!.data[0]!, id: 'app-3' }],
          page: 2,
          limit: 30,
          total: 3,
          has_more: false,
        })
      renderList()
      await waitFor(() => expect(mockObserve).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.getByTestId('app-card-app-1').closest('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false',
        ),
      )
      act(() => {
        for (const callback of [...intersectionCallbacks])
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
      })
      const retryButton = await screen.findByRole('button', { name: 'common.operation.retry' })
      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      await user.click(retryButton)
      expect(await screen.findByTestId('app-card-app-3')).toBeInTheDocument()
      expect(getApps).toHaveBeenCalledTimes(3)
      expect(getApps).toHaveBeenLastCalledWith({ query: expect.objectContaining({ page: 2 }) })
    })
  })
})
