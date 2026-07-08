import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { StepByStepTourAccountState, StepByStepTourUiState } from '@/app/components/step-by-step-tour/types'
import type { Banner as BannerType } from '@/models/app'
import type { App } from '@/models/explore'
import type { App as WorkspaceApp } from '@/types/app'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import {
  StepByStepTourTestStateObserver,
  StepByStepTourTestUiStateHydrator,
} from '@/app/components/step-by-step-tour/__tests__/test-utils'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { useAppContext } from '@/context/app-context'
import { fetchAppDetail, fetchAppList, fetchBanners } from '@/service/explore'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '../../learn-dify/storage'
import AppList from '../index'

type MockAppContext = {
  userProfile: { id: string }
  workspacePermissionKeys: string[]
}

const mockUseAppContext = vi.hoisted(() => vi.fn<() => MockAppContext>())

let mockExploreData: { categories: string[], allList: App[] } | undefined = { categories: [], allList: [] }
let mockLearnDifyApps: App[] = []
let mockLearnDifyLoading = false
let mockWorkspaceApps: WorkspaceApp[] = []
let mockWorkspaceAppsLoading = false
let mockBanners: BannerType[] = []
let mockBannersLoading = false
let mockIsLoading = false
let mockIsError = false
const mockHandleImportDSL = vi.fn()
const mockHandleImportDSLConfirm = vi.fn()
const mockTrackCreateApp = vi.fn()
const mockStepByStepTour = vi.hoisted(() => {
  const stateQueryKey = ['console', 'onboarding', 'step-by-step-tour', 'state'] as const
  const createState = (
    overrides: Partial<StepByStepTourStateResponse> = {},
  ): StepByStepTourStateResponse => ({
    eligible: true,
    first_workspace_id: 'workspace-1',
    skipped: false,
    completed_task_ids: [],
    manually_enabled_workspace_ids: ['workspace-1'],
    manually_disabled_workspace_ids: [],
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  })
  const createUiState = (
    overrides: Partial<StepByStepTourUiState> = {},
  ): StepByStepTourUiState => ({
    activeGuideGroup: undefined,
    activeGuideIndex: undefined,
    activeGuideIndexes: undefined,
    activeTaskId: undefined,
    minimized: false,
    ...overrides,
  })
  let state = createState()
  let uiState: StepByStepTourUiState = createUiState()
  let observedState: StepByStepTourAccountState | undefined
  const patchState = vi.fn(
    async ({ body }: { body: StepByStepTourStatePatchPayload }): Promise<StepByStepTourStateResponse> => {
      switch (body.action) {
        case 'complete_task':
          state = {
            ...state,
            completed_task_ids: body.task_id && !state.completed_task_ids?.includes(body.task_id)
              ? [...(state.completed_task_ids ?? []), body.task_id]
              : state.completed_task_ids,
          }
          break
        case 'uncomplete_task':
          state = {
            ...state,
            completed_task_ids: (state.completed_task_ids ?? []).filter(taskId => taskId !== body.task_id),
          }
          break
        case 'skip':
          state = {
            ...state,
            skipped: true,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(id => id !== 'workspace-1'),
          }
          break
        case 'enable_current_workspace':
          state = {
            ...state,
            skipped: false,
            manually_enabled_workspace_ids: Array.from(new Set([...(state.manually_enabled_workspace_ids ?? []), 'workspace-1'])),
            manually_disabled_workspace_ids: (state.manually_disabled_workspace_ids ?? []).filter(id => id !== 'workspace-1'),
          }
          break
        case 'disable_current_workspace':
          state = {
            ...state,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(id => id !== 'workspace-1'),
            manually_disabled_workspace_ids: Array.from(new Set([...(state.manually_disabled_workspace_ids ?? []), 'workspace-1'])),
          }
          break
      }

      return state
    },
  )

  return {
    get observedState() {
      return observedState
    },
    get state() {
      return state
    },
    get uiState() {
      return uiState
    },
    patchState,
    reset() {
      state = createState()
      uiState = createUiState()
      observedState = undefined
      patchState.mockClear()
    },
    setObservedState(nextState: StepByStepTourAccountState) {
      observedState = nextState
    },
    setState(overrides: Partial<StepByStepTourStateResponse> = {}) {
      state = createState(overrides)
    },
    setUiState(overrides: Partial<StepByStepTourUiState> = {}) {
      uiState = createUiState(overrides)
    },
    stateQueryKey,
  }
})
const toastMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = Object.assign(vi.fn((message: unknown, options?: Record<string, unknown>) => record({ message, ...options })), {
    success: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'success', message, ...options })),
    error: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'error', message, ...options })),
    warning: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'warning', message, ...options })),
    info: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'info', message, ...options })),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { record, api }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks.api,
}))

vi.mock('@/service/use-explore', () => ({
  useLearnDifyAppList: () => ({
    data: mockLearnDifyApps,
    isLoading: mockLearnDifyLoading,
    isError: false,
  }),
}))

vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn(),
  fetchAppList: vi.fn(),
  fetchBanners: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: () => Promise.resolve({}),
  },
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['console', 'systemFeatures'],
      },
    },
    apps: {
      get: {
        queryOptions: (options: {
          input?: { query?: { limit?: number } }
          select?: (response: {
            data: WorkspaceApp[]
            has_more: boolean
            limit: number
            page: number
            total: number
          }) => unknown
        }) => {
          const limit = options.input?.query?.limit ?? mockWorkspaceApps.length
          if (mockWorkspaceAppsLoading) {
            return {
              queryKey: ['console', 'apps', 'get', options],
              queryFn: () => new Promise(() => {}),
              select: options.select,
            }
          }
          const response = {
            data: mockWorkspaceApps.slice(0, limit),
            has_more: false,
            limit,
            page: 1,
            total: mockWorkspaceApps.length,
          }
          return {
            queryKey: ['console', 'apps', 'get', options],
            queryFn: () => Promise.resolve(response),
            initialData: response,
            select: options.select,
          }
        },
      },
    },
    onboarding: {
      stepByStepTour: {
        state: {
          get: {
            queryKey: () => mockStepByStepTour.stateQueryKey,
            queryOptions: () => ({
              queryKey: mockStepByStepTour.stateQueryKey,
              queryFn: async () => mockStepByStepTour.state,
            }),
          },
          patch: {
            mutationOptions: () => ({
              mutationFn: mockStepByStepTour.patchState,
            }),
          },
        },
      },
    },
    explore: {
      apps: {
        get: {
          queryKey: ({ input }: { input?: unknown } = {}) => ['console', 'explore', 'apps', 'get', input],
        },
      },
      banners: {
        get: {
          queryKey: ({ input }: { input?: unknown } = {}) => ['console', 'explore', 'banners', 'get', input],
        },
      },
    },
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: mockUseAppContext,
  useSelector: <T,>(selector: (state: MockAppContext) => T): T => selector(mockUseAppContext()),
}))

vi.mock('@/hooks/use-import-dsl', () => ({
  useImportDSL: () => ({
    handleImportDSL: mockHandleImportDSL,
    handleImportDSLConfirm: mockHandleImportDSLConfirm,
    versions: ['v1'],
    isFetching: false,
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => '3 minutes ago',
  }),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: (...args: unknown[]) => mockTrackCreateApp(...args),
}))

const mockConfig = vi.hoisted(() => ({
  isCloudEdition: false,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get IS_CLOUD_EDITION() {
      return mockConfig.isCloudEdition
    },
  }
})

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: (props: CreateAppModalProps) => {
    if (!props.show)
      return null
    return (
      <div data-testid="create-app-modal">
        <button
          data-testid="confirm-create"
          onClick={() => props.onConfirm({
            name: 'New App',
            icon_type: 'emoji',
            icon: '🤖',
            icon_background: '#fff',
            description: 'desc',
          })}
        >
          confirm
        </button>
        <button data-testid="hide-create" onClick={props.onHide}>hide</button>
      </div>
    )
  },
}))

vi.mock('../../try-app', () => ({
  default: ({
    canCreate = true,
    createButtonStepByStepTourTarget,
    onCreate,
    onClose,
  }: {
    canCreate?: boolean
    createButtonStepByStepTourTarget?: string
    onCreate: () => void
    onClose: () => void
  }) => (
    <div data-testid="try-app-panel">
      {canCreate && (
        <button
          data-testid="try-app-create"
          data-step-by-step-tour-target={createButtonStepByStepTourTarget}
          onClick={onCreate}
        >
          create
        </button>
      )}
      <button data-testid="try-app-close" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('../../banner/banner', () => ({
  default: ({ banners }: { banners: BannerType[] }) => (
    <div data-testid="explore-banner" data-banner-count={banners.length}>banner</div>
  ),
}))

vi.mock('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div data-testid="dsl-confirm-modal">
      <button data-testid="dsl-confirm" onClick={onConfirm}>confirm</button>
      <button data-testid="dsl-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '😀',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Alpha',
    description: overrides.app?.description ?? 'Alpha description',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
  can_trial: true,
  app_id: overrides.app_id ?? 'app-1',
  description: overrides.description ?? 'Alpha description',
  copyright: overrides.copyright ?? '',
  privacy_policy: overrides.privacy_policy ?? null,
  custom_disclaimer: overrides.custom_disclaimer ?? null,
  categories: overrides.categories ?? ['Writing'],
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
  install_count: overrides.install_count ?? 0,
  installed: overrides.installed ?? false,
  editable: overrides.editable ?? false,
  is_agent: overrides.is_agent ?? false,
})

const createWorkspaceApp = (overrides: Partial<WorkspaceApp> = {}): WorkspaceApp => ({
  id: overrides.id ?? 'workspace-app-1',
  name: overrides.name ?? 'Workspace App',
  description: overrides.description ?? 'Workspace app description',
  author_name: overrides.author_name ?? 'Evan',
  icon_type: overrides.icon_type ?? 'emoji',
  icon: overrides.icon ?? '😀',
  icon_background: overrides.icon_background ?? '#fff',
  icon_url: overrides.icon_url ?? null,
  use_icon_as_answer_icon: overrides.use_icon_as_answer_icon ?? false,
  mode: overrides.mode ?? AppModeEnum.CHAT,
  created_at: overrides.created_at ?? 1704067200,
  updated_at: overrides.updated_at ?? 1704153600,
  enable_site: overrides.enable_site ?? false,
  enable_api: overrides.enable_api ?? false,
  api_rpm: overrides.api_rpm ?? 60,
  api_rph: overrides.api_rph ?? 3600,
  is_demo: overrides.is_demo ?? false,
  model_config: overrides.model_config,
  app_model_config: overrides.app_model_config,
  site: overrides.site,
  api_base_url: overrides.api_base_url ?? '',
  tags: overrides.tags ?? [],
  access_mode: overrides.access_mode,
  permission_keys: overrides.permission_keys,
} as WorkspaceApp)

const createBanner = (overrides: Partial<BannerType> = {}): BannerType => ({
  id: overrides.id ?? 'banner-1',
  status: overrides.status ?? 'enabled',
  link: overrides.link ?? 'https://example.com',
  content: overrides.content ?? {
    'category': 'Featured',
    'title': 'Explore Banner',
    'description': 'Banner description',
    'img-src': 'https://example.com/banner.png',
  },
  sort: overrides.sort ?? 1,
  created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
})

const mockAppCreatePermission = (hasEditPermission: boolean) => {
  ;(useAppContext as Mock).mockReturnValue({
    currentWorkspace: {
      id: 'workspace-1',
      name: 'Solar Studio',
      role: 'owner',
    },
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: hasEditPermission ? ['app.create_and_management'] : [],
  })
}

type RenderOptions = {
  enableExploreBanner?: boolean
  enableLearnApp?: boolean
  isCloudEdition?: boolean
}

const localeInput = { query: { language: 'en' } }
const exploreAppListQueryKey = ['console', 'explore', 'apps', 'get', localeInput, 'en']
const exploreBannersQueryKey = ['console', 'explore', 'banners', 'get', localeInput, 'en']

const renderAppList = (
  hasEditPermission = false,
  onSuccess?: () => void,
  searchParams?: Record<string, string>,
  options: RenderOptions = {},
) => {
  mockConfig.isCloudEdition = options.isCloudEdition ?? false
  mockAppCreatePermission(hasEditPermission)
  const { wrapper: SystemFeaturesWrapper, queryClient } = createSystemFeaturesWrapper({
    systemFeatures: {
      enable_explore_banner: options.enableExploreBanner ?? false,
      enable_learn_app: options.enableLearnApp ?? true,
    },
  })
  if (!mockIsLoading && !mockIsError && mockExploreData)
    queryClient.setQueryData(exploreAppListQueryKey, mockExploreData)
  if (options.enableExploreBanner && !mockBannersLoading)
    queryClient.setQueryData(exploreBannersQueryKey, mockBanners)
  queryClient.setQueryData(mockStepByStepTour.stateQueryKey, mockStepByStepTour.state)

  const mockFetchAppList = fetchAppList as unknown as Mock
  const mockFetchBanners = fetchBanners as unknown as Mock
  const jotaiStore = createStore()

  if (mockIsLoading) {
    mockFetchAppList.mockImplementation(() => new Promise(() => {}))
  }
  else if (mockIsError) {
    mockFetchAppList.mockRejectedValue(new Error('Failed to load explore apps'))
  }
  else {
    mockFetchAppList.mockResolvedValue({
      categories: mockExploreData?.categories ?? [],
      recommended_apps: mockExploreData?.allList ?? [],
    })
  }

  if (mockBannersLoading) {
    mockFetchBanners.mockImplementation(() => new Promise(() => {}))
  }
  else {
    mockFetchBanners.mockResolvedValue(mockBanners)
  }

  const Wrapped = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={jotaiStore}>
      <SystemFeaturesWrapper>
        <StepByStepTourTestUiStateHydrator initialState={mockStepByStepTour.uiState}>
          <StepByStepTourTestStateObserver onChange={mockStepByStepTour.setObservedState} />
          {children}
        </StepByStepTourTestUiStateHydrator>
      </SystemFeaturesWrapper>
    </JotaiProvider>
  )
  const rendered = renderWithNuqs(
    <Wrapped><AppList onSuccess={onSuccess} /></Wrapped>,
    { searchParams },
  )
  return { ...rendered, queryClient }
}

describe('AppList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()
    mockExploreData = { categories: [], allList: [] }
    mockLearnDifyApps = [
      createApp({
        app_id: 'learn-1',
        app: { ...createApp().app, id: 'learn-basic-1', name: 'Learn Workflow Basics' },
        description: 'Build your first workflow from a template.',
        position: 1,
      }),
      createApp({
        app_id: 'learn-2',
        app: { ...createApp().app, id: 'learn-basic-2', name: 'Learn Agent Basics' },
        description: 'Connect agent reasoning with tools.',
        position: 2,
      }),
    ]
    mockLearnDifyLoading = false
    mockWorkspaceApps = []
    mockWorkspaceAppsLoading = false
    mockBanners = []
    mockBannersLoading = false
    mockIsLoading = false
    mockIsError = false
    mockConfig.isCloudEdition = false
    mockStepByStepTour.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render the home shell skeleton when the explore query is loading', () => {
      mockExploreData = undefined
      mockIsLoading = true
      mockWorkspaceAppsLoading = true
      mockLearnDifyLoading = true

      renderAppList()

      expect(screen.queryByText('explore.apps.description')).not.toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
    })

    it('should keep the whole home page in the initial skeleton while continue work apps are loading', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceAppsLoading = true

      renderAppList()

      expect(screen.queryByRole('heading', { name: 'explore.continueWork.title' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
    })

    it('should not render learn dify content while learn dify items are loading', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockLearnDifyApps = []
      mockLearnDifyLoading = true

      renderAppList()

      expect(screen.queryByRole('heading', { name: 'explore.learnDify.title' })).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('should not show the learn dify placeholder when the section is hidden', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockLearnDifyApps = []
      mockLearnDifyLoading = true
      localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

      renderAppList()

      expect(screen.queryByRole('heading', { name: 'explore.learnDify.title' })).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('should render app cards when data is available', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, categories: ['Translate'] })],
      }

      renderAppList()

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
      expect(screen.getByText('explore.apps.title')).toBeInTheDocument()
    })

    it('should render continue work with the first eight workspace apps', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = [
        createWorkspaceApp({ id: 'app-1', name: 'Email Reply', author_name: 'Evan', permission_keys: [AppACLPermission.Monitor] }),
        createWorkspaceApp({ id: 'app-2', name: 'Feature Copilot', author_name: 'Maggie' }),
        createWorkspaceApp({ id: 'app-3', name: 'Book Translation', author_name: 'Alex' }),
        createWorkspaceApp({ id: 'app-4', name: 'Logo Design', author_name: 'Taylor' }),
        createWorkspaceApp({ id: 'app-5', name: 'Data Summarizer', author_name: 'Robin' }),
        createWorkspaceApp({ id: 'app-6', name: 'Meeting Notes', author_name: 'Casey' }),
        createWorkspaceApp({ id: 'app-7', name: 'Research Helper', author_name: 'Jordan' }),
        createWorkspaceApp({ id: 'app-8', name: 'Support Draft', author_name: 'Morgan' }),
        createWorkspaceApp({ id: 'app-9', name: 'Hidden Ninth App', author_name: 'Riley' }),
      ]

      renderAppList()

      expect(screen.getByRole('heading', { name: 'explore.continueWork.title' })).toBeInTheDocument()
      expect(screen.getByText('Email Reply')).toBeInTheDocument()
      expect(screen.getByText('Feature Copilot')).toBeInTheDocument()
      expect(screen.getByText('Book Translation')).toBeInTheDocument()
      expect(screen.getByText('Logo Design')).toBeInTheDocument()
      expect(screen.getByText('Data Summarizer')).toBeInTheDocument()
      expect(screen.getByText('Meeting Notes')).toBeInTheDocument()
      expect(screen.getByText('Research Helper')).toBeInTheDocument()
      expect(screen.getByText('Support Draft')).toBeInTheDocument()
      expect(screen.queryByText('Hidden Ninth App')).not.toBeInTheDocument()
      expect(screen.getByText('Maggie')).toBeInTheDocument()
      expect(screen.getAllByText('explore.continueWork.editedAt:{"time":"3 minutes ago"}')).toHaveLength(8)
      expect(screen.getByRole('link', { name: /Email Reply/ })).toHaveAttribute('href', '/app/app-1/overview')
      expect(screen.getByRole('link', { name: 'explore.continueWork.exploreStudio' })).toHaveAttribute('href', '/apps')
    })

    it('should render preview-only continue work app as a dimmed card and warn on click', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = [
        createWorkspaceApp({
          id: 'preview-app',
          name: 'Preview Only App',
          author_name: 'Readonly Author',
          permission_keys: [AppACLPermission.Preview],
        }),
      ]

      renderAppList()

      const card = screen.getByRole('button', { name: 'Preview Only App' })
      expect(card).toHaveClass('opacity-60')
      expect(card).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('link', { name: /Preview Only App/ })).not.toBeInTheDocument()
      expect(screen.getByText('Readonly Author')).toBeInTheDocument()

      fireEvent.click(card)

      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'warning',
        message: 'app.noAccessResourcePermission',
      })
    })

    it('should hide continue work when there are no workspace apps', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = []

      renderAppList()

      expect(screen.queryByRole('heading', { name: 'explore.continueWork.title' })).not.toBeInTheDocument()
    })

    it('should render learn dify templates without badges or template metadata', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList()

      const learnDifyHeading = screen.getByRole('heading', { name: 'explore.learnDify.title' })
      expect(learnDifyHeading).toBeInTheDocument()
      expect(learnDifyHeading.closest('section')).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.home,
      )
      expect(screen.getByText('Learn Workflow Basics')).toBeInTheDocument()
      expect(screen.getByText('Learn Agent Basics')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'explore.learnDify.moreTemplates' })).not.toBeInTheDocument()
      expect(screen.queryByText('Run this first')).not.toBeInTheDocument()
      expect(screen.queryByText('Then try this')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow')).not.toBeInTheDocument()
      expect(screen.queryByText('3 min')).not.toBeInTheDocument()
    })

    it('should hide learn dify templates when learn app is disabled', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList(false, undefined, undefined, { enableLearnApp: false })

      expect(screen.queryByRole('heading', { name: 'explore.learnDify.title' })).not.toBeInTheDocument()
      expect(screen.queryByText('Learn Workflow Basics')).not.toBeInTheDocument()
    })

    it('should collapse learn dify and persist hidden state when hide is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList()

      fireEvent.click(screen.getByRole('button', { name: 'explore.learnDify.hide' }))

      const learnDifySection = screen.getByRole('heading', { name: 'explore.learnDify.title' }).closest('section')
      expect(learnDifySection).toHaveClass('z-50', 'opacity-20')
      expect(learnDifySection).toHaveStyle({ transform: 'scale(0.08)' })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(screen.queryByRole('heading', { name: 'explore.learnDify.title' })).not.toBeInTheDocument()
      expect(localStorage.getItem(LEARN_DIFY_HIDDEN_STORAGE_KEY)).toBe('true')
    })
  })

  describe('Props', () => {
    it('should filter apps by selected category', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, categories: ['Translate'] })],
      }

      renderAppList(false, undefined, { category: 'Writing' })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })

    it('should hide categories without apps even when the API returns them', () => {
      mockExploreData = {
        categories: ['Writing', 'c'],
        allList: [createApp()],
      }

      renderAppList(false, undefined, { category: 'c' })

      expect(screen.queryByRole('radio', { name: 'c' })).not.toBeInTheDocument()
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })

    it('should keep selected category when clearing search text', async () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, categories: ['Translate'] })],
      }

      renderAppList(false, undefined, { category: 'Writing' })

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'alp' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should filter apps by search keywords', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('should handle create flow from app card when outside cloud edition and confirm DSL when pending', async () => {
      vi.useRealTimers()
      const onSuccess = vi.fn()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml-content', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: () => void, onPending?: () => void }) => {
        options.onPending?.()
      })
      mockHandleImportDSLConfirm.mockImplementation(async (options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
        options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
      })

      renderAppList(true, onSuccess)
      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(fetchAppDetail).toHaveBeenCalledWith('app-basic-id')
      })
      expect(mockHandleImportDSL).toHaveBeenCalledTimes(1)
      expect(await screen.findByTestId('dsl-confirm-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('dsl-confirm'))
      await waitFor(() => {
        expect(mockHandleImportDSLConfirm).toHaveBeenCalledTimes(1)
        expect(mockTrackCreateApp).toHaveBeenCalledWith({
          source: 'explore_template_list',
          appMode: AppModeEnum.CHAT,
          templateId: 'app-1',
        })
        expect(onSuccess).toHaveBeenCalledTimes(1)
      })
    })

    it('should open create flow from learn dify item card click', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml-content', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
        options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
      })

      renderAppList(true)
      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(fetchAppDetail).toHaveBeenCalledWith('learn-basic-1')
      })
      expect(mockHandleImportDSL).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          skipRedirectOnSuccess: false,
        }),
      )
    })

    it('should advance the Learn Dify tour to the create button after a lesson opens', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
        minimized: true,
      })

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()
      expect(screen.getByTestId('try-app-create')).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )
      await waitFor(() => {
        const state = mockStepByStepTour.observedState
        expect(state?.activeTaskId).toBe('home')
        expect(state?.activeGuideIndex).toBe(1)
        expect(state?.completedTaskIds).toEqual([])
      })
    })

    it('should complete the Learn Dify tour when a no-create user opens a lesson detail', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        minimized: true,
      })

      renderAppList(false, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('try-app-create')).not.toBeInTheDocument()
      await waitFor(() => {
        const state = mockStepByStepTour.observedState
        expect(state?.activeTaskId).toBeUndefined()
        expect(state?.activeGuideIndex).toBeUndefined()
        expect(state?.activeGuideGroup).toBeUndefined()
        expect(state?.activeGuideIndexes).toBeUndefined()
        expect(state?.completedTaskIds).toEqual(['home'])
        expect(state?.minimized).toBe(false)
      })
    })

    it('should complete the Learn Dify tour only after the app is created from details', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
        minimized: true,
      });
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml-content', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
        options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
      })

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))
      fireEvent.click(await screen.findByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        const state = mockStepByStepTour.observedState
        expect(state?.activeTaskId).toBeUndefined()
        expect(state?.activeGuideIndex).toBeUndefined()
        expect(state?.activeGuideIndexes).toBeUndefined()
        expect(state?.completedTaskIds).toEqual(['home'])
      })
      expect(mockHandleImportDSL).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          skipRedirectOnSuccess: true,
        }),
      )
    })

    it('should skip redirect after confirming a pending Learn Dify tour create', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        minimized: true,
      });
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml-content', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onPending?: () => void }) => {
        options.onPending?.()
      })
      mockHandleImportDSLConfirm.mockImplementation(async (options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
        options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
      })

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))
      fireEvent.click(await screen.findByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('confirm-create'))
      fireEvent.click(await screen.findByTestId('dsl-confirm'))

      await waitFor(() => {
        expect(mockHandleImportDSLConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            skipRedirectOnSuccess: true,
          }),
        )
      })
    })

    it('should hide the Learn Dify tour target while the create modal is open and abandon on cancel', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
        minimized: true,
      })

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))
      const createFromDetailsButton = await screen.findByTestId('try-app-create')
      expect(createFromDetailsButton).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )

      fireEvent.click(createFromDetailsButton)
      expect(await screen.findByTestId('create-app-modal')).toBeInTheDocument()
      expect(createFromDetailsButton).not.toHaveAttribute('data-step-by-step-tour-target')

      fireEvent.click(screen.getByTestId('hide-create'))

      await waitFor(() => {
        const state = mockStepByStepTour.observedState
        expect(state?.activeTaskId).toBeUndefined()
        expect(state?.activeGuideIndex).toBeUndefined()
        expect(state?.activeGuideIndexes).toBeUndefined()
        expect(state?.completedTaskIds).toEqual([])
      })
      expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()
    })

    it('should restart the Learn Dify tour from a clean state after abandoning create', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        minimized: true,
      })
      const { unmount } = renderAppList(true, undefined, undefined, {
        isCloudEdition: true,
      })

      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))
      fireEvent.click(await screen.findByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('hide-create'))

      await waitFor(() => {
        const state = mockStepByStepTour.observedState
        expect(state?.activeTaskId).toBeUndefined()
        expect(state?.activeGuideIndex).toBeUndefined()
      })
      expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()

      const abandonedTourState = mockStepByStepTour.observedState
      if (!abandonedTourState)
        throw new Error('Step-by-step tour state should be ready before restarting the home tour.')
      unmount()
      mockStepByStepTour.setState({
        active_task_id: 'home',
        active_guide_index: 0,
        completed_task_ids: abandonedTourState.completedTaskIds,
        first_workspace_id: abandonedTourState.firstWorkspaceId,
        manually_disabled_workspace_ids: abandonedTourState.manuallyDisabledWorkspaceIds,
        manually_enabled_workspace_ids: abandonedTourState.manuallyEnabledWorkspaceIds,
        minimized: true,
        skipped: abandonedTourState.skipped,
      })
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        minimized: true,
      })

      renderAppList(true, undefined, undefined, { isCloudEdition: true })
      fireEvent.click(screen.getByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()
      expect(screen.getByTestId('try-app-create')).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )
      await waitFor(() => {
        const state = mockStepByStepTour.observedState
        expect(state?.activeTaskId).toBe('home')
        expect(state?.activeGuideIndex).toBe(1)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should reset search results when clear icon is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('should render nothing when isError is true', async () => {
      vi.useRealTimers()
      mockIsError = true
      mockExploreData = undefined

      const { container } = renderAppList()

      await waitFor(() => {
        expect(container.innerHTML).toBe('')
      })
    })

    it('should render the initial skeleton while app list data is pending', () => {
      mockExploreData = undefined
      mockIsLoading = true

      renderAppList()

      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    })

    it('should close create modal via hide button', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml', mode: AppModeEnum.CHAT })

      renderAppList(true)
      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      expect(await screen.findByTestId('create-app-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('hide-create'))
      await waitFor(() => {
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
      expect(mockTrackCreateApp).not.toHaveBeenCalled()
    })

    it('should close create modal on successful DSL import', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
        options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
      })

      renderAppList(true)
      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should cancel DSL confirm modal', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onPending?: () => void }) => {
        options.onPending?.()
      })

      renderAppList(true)
      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(screen.getByTestId('dsl-confirm-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('dsl-cancel'))
      await waitFor(() => {
        expect(screen.queryByTestId('dsl-confirm-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('TryApp Panel', () => {
    it('should open create modal from try app panel', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('try-app-create'))

      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
      })
    })

    it('should track preview source when creation starts from try app details', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml', mode: AppModeEnum.CHAT })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
        options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
      })

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      await screen.findByTestId('try-app-panel')
      fireEvent.click(screen.getByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(mockTrackCreateApp).toHaveBeenCalledWith({
          source: 'explore_template_preview',
          appMode: AppModeEnum.CHAT,
          templateId: 'app-1',
        })
      })
    })

    it('should close try app panel when close is clicked', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList(true, undefined, undefined, { isCloudEdition: true })

      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('try-app-close'))
      expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()
    })
  })

  describe('Banner', () => {
    it('should render banner when enable_explore_banner is true', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockBanners = [createBanner()]

      renderAppList(false, undefined, undefined, { enableExploreBanner: true })

      expect(screen.getByTestId('explore-banner')).toBeInTheDocument()
      expect(screen.getByTestId('explore-banner')).toHaveAttribute('data-banner-count', '1')
    })

    it('should keep the whole home page in the initial skeleton while banners are loading', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockBannersLoading = true

      renderAppList(false, undefined, undefined, { enableExploreBanner: true })

      expect(screen.queryByTestId('explore-banner')).not.toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
    })
  })
})
