import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import type { App } from '@/models/explore'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider, useSetAtom } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/utils'
import {
  resetStepByStepTourSessionAtom,
  stepByStepTourSessionAtom,
} from '@/app/components/step-by-step-tour/state'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { fetchAppDetail, fetchAppList } from '@/service/explore'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '../../learn-dify/storage'
import AppList from '../index'

type StepByStepTourTestUiState = StepByStepTourSessionState & { minimized: boolean }

function StepByStepTourSessionFixture({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: StepByStepTourSessionState
}) {
  useHydrateAtoms([[stepByStepTourSessionAtom, initialState]], {
    dangerouslyForceHydrate: true,
  })

  return children
}

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  currentWorkspace: { id: 'workspace-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockExploreData: { categories: string[]; allList: App[] } | undefined = {
  categories: [],
  allList: [],
}
let mockLearnDifyApps: App[] = []
let mockLearnDifyLoading = false
let mockLearnDifyError = false
let mockWorkspaceApps: RecentAppResponse[] = []
let mockWorkspaceAppsLoading = false
let mockWorkspaceAppsError = false
let mockIsLoading = false
let mockIsError = false
const mockHandleImportDSL = vi.fn()
const mockHandleImportDSLConfirm = vi.fn()
const mockTrackCreateApp = vi.fn()
const mockTrackEvent = vi.hoisted(() => vi.fn())
const mockAppQueries = vi.hoisted(() => ({
  listQueryOptions: vi.fn(),
  recentQueryOptions: vi.fn(),
}))
const mockLearnDifyQuery = vi.hoisted(() => ({
  useQuery: vi.fn(),
}))
const mockStepByStepTour = vi.hoisted(() => {
  const stateQueryKey = ['console', 'onboarding', 'step-by-step-tour', 'state'] as const
  const createState = (
    overrides: Partial<StepByStepTourStateResponse> = {},
  ): StepByStepTourStateResponse => ({
    first_workspace_id: 'workspace-1',
    skipped: false,
    completed_task_ids: [],
    manually_enabled_workspace_ids: ['workspace-1'],
    manually_disabled_workspace_ids: [],
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  })
  const createUiState = (
    overrides: Partial<StepByStepTourTestUiState> = {},
  ): StepByStepTourTestUiState => ({
    activeGuideGroup: undefined,
    activeGuideIndex: undefined,
    activeGuideIndexes: undefined,
    activeTaskId: undefined,
    minimized: false,
    ...overrides,
  })
  let state = createState()
  let uiState: StepByStepTourTestUiState = createUiState()
  const patchState = vi.fn(
    async ({
      body,
    }: {
      body: StepByStepTourStatePatchPayload
    }): Promise<StepByStepTourStateResponse> => {
      switch (body.action) {
        case 'complete_task':
          state = {
            ...state,
            completed_task_ids:
              body.task_id && !state.completed_task_ids?.includes(body.task_id)
                ? [...(state.completed_task_ids ?? []), body.task_id]
                : state.completed_task_ids,
          }
          break
        case 'uncomplete_task':
          state = {
            ...state,
            completed_task_ids: (state.completed_task_ids ?? []).filter(
              (taskId) => taskId !== body.task_id,
            ),
          }
          break
        case 'skip':
          state = {
            ...state,
            skipped: true,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
            ),
          }
          break
        case 'enable_current_workspace':
          state = {
            ...state,
            skipped: false,
            manually_enabled_workspace_ids: Array.from(
              new Set([...(state.manually_enabled_workspace_ids ?? []), 'workspace-1']),
            ),
            manually_disabled_workspace_ids: (state.manually_disabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
            ),
          }
          break
        case 'disable_current_workspace':
          state = {
            ...state,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
            ),
            manually_disabled_workspace_ids: Array.from(
              new Set([...(state.manually_disabled_workspace_ids ?? []), 'workspace-1']),
            ),
          }
          break
      }

      return state
    },
  )

  return {
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
      patchState.mockClear()
    },
    setState(overrides: Partial<StepByStepTourStateResponse> = {}) {
      state = createState(overrides)
    },
    setUiState(overrides: Partial<StepByStepTourTestUiState> = {}) {
      uiState = createUiState(overrides)
    },
    stateQueryKey,
  }
})
const toastMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = Object.assign(
    vi.fn((message: unknown, options?: Record<string, unknown>) => record({ message, ...options })),
    {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'success', message, ...options }),
      ),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'error', message, ...options }),
      ),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'warning', message, ...options }),
      ),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'info', message, ...options }),
      ),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    },
  )
  return { record, api }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks.api,
}))

vi.mock('@/service/use-explore', () => ({
  useLearnDifyAppList: (options: { enabled?: boolean }) => {
    mockLearnDifyQuery.useQuery(options)
    return {
      data: mockLearnDifyApps,
      isLoading: mockLearnDifyLoading,
      isPending: mockLearnDifyLoading,
      isError: mockLearnDifyError,
      isSuccess: !mockLearnDifyLoading && !mockLearnDifyError,
    }
  },
}))

vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn(),
  fetchAppList: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mockTrackEvent,
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: () => Promise.resolve({}),
  },
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['console', 'systemFeatures'],
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ['console', 'systemFeatures'],
          ...options,
        }),
      },
    },
    apps: {
      get: {
        queryOptions: (options: {
          input?: { query?: { limit?: number } }
          select?: (response: {
            data: RecentAppResponse[]
            has_more: boolean
            limit: number
            page: number
            total: number
          }) => unknown
        }) => {
          mockAppQueries.listQueryOptions(options)
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
      recent: {
        get: {
          queryOptions: (options: {
            input?: { query?: { limit?: number } }
            select?: (response: { data: RecentAppResponse[] }) => unknown
          }) => {
            mockAppQueries.recentQueryOptions(options)
            const limit = options.input?.query?.limit ?? mockWorkspaceApps.length
            if (mockWorkspaceAppsLoading || mockWorkspaceAppsError) {
              return {
                queryKey: ['console', 'apps', 'recent', 'get', options],
                queryFn: () => {
                  if (mockWorkspaceAppsLoading) return new Promise(() => {})
                  if (mockWorkspaceAppsError)
                    return Promise.reject(new Error('Failed to load recent apps'))

                  return Promise.resolve({
                    data: mockWorkspaceApps.slice(0, limit),
                  })
                },
                select: options.select,
              }
            }
            const response = {
              data: mockWorkspaceApps.slice(0, limit),
            }
            return {
              queryKey: ['console', 'apps', 'recent', 'get', options],
              queryFn: () => Promise.resolve(response),
              initialData: response,
              select: options.select,
            }
          },
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
            mutationOptions: (options = {}) => ({
              mutationFn: mockStepByStepTour.patchState,
              ...options,
            }),
          },
        },
      },
    },
    explore: {
      apps: {
        get: {
          queryKey: ({ input }: { input?: unknown } = {}) => [
            'console',
            'explore',
            'apps',
            'get',
            input,
          ],
        },
      },
    },
  },
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

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

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: (props: CreateAppModalProps) => {
    if (!props.show) return null
    return (
      <div data-testid="create-app-modal">
        <button
          data-testid="confirm-create"
          onClick={() =>
            props.onConfirm({
              name: 'New App',
              icon_type: 'emoji',
              icon: '🤖',
              icon_background: '#fff',
              description: 'desc',
            })
          }
        >
          confirm
        </button>
        <button data-testid="hide-create" onClick={props.onHide}>
          hide
        </button>
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
      <button data-testid="try-app-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="dsl-confirm-modal">
      <button data-testid="dsl-confirm" onClick={onConfirm}>
        confirm
      </button>
      <button data-testid="dsl-cancel" onClick={onCancel}>
        cancel
      </button>
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

const createWorkspaceApp = (overrides: Partial<RecentAppResponse> = {}): RecentAppResponse => ({
  id: overrides.id ?? 'workspace-app-1',
  name: overrides.name ?? 'Workspace App',
  author_name: overrides.author_name ?? 'Evan',
  icon_type: overrides.icon_type ?? 'emoji',
  icon: overrides.icon ?? '😀',
  icon_background: overrides.icon_background ?? '#fff',
  icon_url: overrides.icon_url ?? null,
  mode: overrides.mode ?? 'chat',
  updated_at: overrides.updated_at ?? 1704153600,
  maintainer: overrides.maintainer ?? 'user-1',
  permission_keys: overrides.permission_keys,
})

const mockAppCreatePermission = (hasEditPermission: boolean) => {
  mockConsoleState.workspacePermissionKeys = hasEditPermission ? ['app.create_and_management'] : []
}

type RenderOptions = {
  enableLearnApp?: boolean
  extra?: ReactNode
  children?: ReactNode
  deploymentEdition?: DeploymentEdition
}

const localeInput = { query: { language: 'en-US' } }
const exploreAppListQueryKey = ['console', 'explore', 'apps', 'get', localeInput, 'en-US']

const renderAppList = (
  hasEditPermission = false,
  onSuccess?: () => void,
  searchParams?: Record<string, string>,
  options: RenderOptions = {},
) => {
  mockAppCreatePermission(hasEditPermission)
  const { wrapper: ConsoleQueryWrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: {
      deployment_edition: options.deploymentEdition ?? 'COMMUNITY',
      enable_learn_app: options.enableLearnApp ?? true,
    },
  })
  if (!mockIsLoading && !mockIsError && mockExploreData)
    queryClient.setQueryData(exploreAppListQueryKey, mockExploreData)
  queryClient.setQueryData(mockStepByStepTour.stateQueryKey, mockStepByStepTour.state)

  const mockFetchAppList = fetchAppList as unknown as Mock
  const jotaiStore = createStore()
  seedRegisteredConsoleStateFixture(jotaiStore)
  jotaiStore.set(queryClientAtom, queryClient)

  if (mockIsLoading) {
    mockFetchAppList.mockImplementation(() => new Promise(() => {}))
  } else if (mockIsError) {
    mockFetchAppList.mockRejectedValue(new Error('Failed to load explore apps'))
  } else {
    mockFetchAppList.mockResolvedValue({
      categories: mockExploreData?.categories ?? [],
      recommended_apps: mockExploreData?.allList ?? [],
    })
  }

  const Wrapped = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={jotaiStore}>
      <ConsoleQueryWrapper>
        <StepByStepTourSessionFixture initialState={mockStepByStepTour.uiState}>
          {children}
          {options.extra}
        </StepByStepTourSessionFixture>
      </ConsoleQueryWrapper>
    </JotaiProvider>
  )
  const rendered = renderWithNuqs(
    <Wrapped>
      <AppList onSuccess={onSuccess}>{options.children}</AppList>
    </Wrapped>,
    { searchParams },
  )
  return { ...rendered, queryClient }
}

function SkipHomeGuideProbe() {
  const resetStepByStepTourSession = useSetAtom(resetStepByStepTourSessionAtom)

  return (
    <button type="button" data-testid="skip-home-guide" onClick={resetStepByStepTourSession}>
      skip home guide
    </button>
  )
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
    mockLearnDifyError = false
    mockWorkspaceApps = []
    mockWorkspaceAppsLoading = false
    mockWorkspaceAppsError = false
    mockIsLoading = false
    mockIsError = false
    mockStepByStepTour.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should start all body queries and show independent middle and templates skeletons', () => {
      mockExploreData = undefined
      mockIsLoading = true
      mockWorkspaceAppsLoading = true
      mockLearnDifyLoading = true

      renderAppList()

      expect(screen.queryByText('explore.apps.description')).not.toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(2)
      expect(fetchAppList).toHaveBeenCalled()
      expect(mockAppQueries.recentQueryOptions).toHaveBeenCalled()
      expect(mockLearnDifyQuery.useQuery).toHaveBeenCalledWith({ enabled: true })
    })

    it('should reveal ready templates when the middle safety deadline expires', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceAppsLoading = true

      renderAppList()

      expect(
        screen.queryByRole('heading', { name: 'explore.continueWork.title' }),
      ).not.toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('should render Continue Work when its request resolves after the middle deadline', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceAppsLoading = true

      const { queryClient } = renderAppList()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      const lateApps = [createWorkspaceApp({ name: 'Late Continue Work' })]
      const [recentAppsQuery] = queryClient.getQueryCache().findAll({
        queryKey: ['console', 'apps', 'recent', 'get'],
      })
      expect(recentAppsQuery).toBeDefined()

      await act(async () => {
        queryClient.setQueryData(recentAppsQuery?.queryKey ?? [], { data: lateApps })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(queryClient.getQueryData(recentAppsQuery?.queryKey ?? [])).toEqual({ data: lateApps })
      expect(screen.getByText('Late Continue Work')).toBeInTheDocument()
    })

    it('should reveal ready Continue Work when the Learn Dify deadline expires', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = [createWorkspaceApp({ name: 'Ready Continue Work' })]
      mockLearnDifyApps = []
      mockLearnDifyLoading = true

      renderAppList()

      expect(screen.queryByText('Ready Continue Work')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(screen.getByText('Ready Continue Work')).toBeInTheDocument()
      expect(screen.getByText('Alpha')).toBeInTheDocument()
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

      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
      expect(mockLearnDifyQuery.useQuery).toHaveBeenCalledWith({ enabled: false })
    })

    it('should keep the banner server child visible while body queries are pending', () => {
      mockExploreData = undefined
      mockIsLoading = true
      mockWorkspaceAppsLoading = true
      mockLearnDifyLoading = true

      renderAppList(false, undefined, undefined, {
        children: <div data-testid="home-banner-boundary">banner</div>,
      })

      expect(screen.getByTestId('home-banner-boundary')).toBeInTheDocument()
      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(2)
    })

    it('should render app cards when data is available', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [
          createApp(),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, name: 'Beta' },
            categories: ['Translate'],
          }),
        ],
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
        createWorkspaceApp({
          id: 'app-1',
          name: 'Email Reply',
          author_name: 'Evan',
          permission_keys: [AppACLPermission.Monitor],
        }),
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

      expect(
        screen.getByRole('heading', { name: 'explore.continueWork.title' }),
      ).toBeInTheDocument()
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
      expect(
        screen.getAllByText('explore.continueWork.editedAt:{"time":"3 minutes ago"}'),
      ).toHaveLength(8)
      expect(screen.getByRole('link', { name: /Email Reply/ })).toHaveAttribute(
        'href',
        '/app/app-1/overview',
      )
      expect(
        screen.getByRole('link', { name: 'explore.continueWork.exploreStudio' }),
      ).toHaveAttribute('href', '/apps')
    })

    it('should load continue work from the lightweight recent apps query', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = [createWorkspaceApp()]

      renderAppList()

      expect(mockAppQueries.recentQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            query: {
              limit: 8,
            },
          },
        }),
      )
      expect(mockAppQueries.listQueryOptions).not.toHaveBeenCalled()
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

      expect(
        screen.queryByRole('heading', { name: 'explore.continueWork.title' }),
      ).not.toBeInTheDocument()
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
      expect(
        screen.queryByRole('link', { name: 'explore.learnDify.moreTemplates' }),
      ).not.toBeInTheDocument()
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

      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Learn Workflow Basics')).not.toBeInTheDocument()
    })

    it('should silently omit learn dify when its request fails', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockLearnDifyApps = []
      mockLearnDifyError = true

      renderAppList()

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('should silently omit Continue Work when its request fails', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceAppsError = true

      renderAppList()

      expect(await screen.findByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('should collapse learn dify and persist hidden state when hide is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList()

      fireEvent.click(screen.getByRole('button', { name: 'explore.learnDify.hide' }))

      const learnDifySection = screen
        .getByRole('heading', { name: 'explore.learnDify.title' })
        .closest('section')
      expect(learnDifySection).toHaveClass('z-50', 'opacity-20')
      expect(learnDifySection).toHaveStyle({ transform: 'scale(0.08)' })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(localStorage.getItem(LEARN_DIFY_HIDDEN_STORAGE_KEY)).toBe('true')
    })
  })

  describe('Props', () => {
    it('should filter apps by selected category', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [
          createApp(),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, name: 'Beta' },
            categories: ['Translate'],
          }),
        ],
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
        allList: [
          createApp(),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, name: 'Beta' },
            categories: ['Translate'],
          }),
        ],
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
        allList: [
          createApp(),
          createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } }),
        ],
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
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml-content',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (_payload: unknown, options: { onSuccess?: () => void; onPending?: () => void }) => {
          options.onPending?.()
        },
      )
      mockHandleImportDSLConfirm.mockImplementation(
        async (options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

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
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml-content',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (
          _payload: unknown,
          options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void },
        ) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

      renderAppList(true)
      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByTestId('confirm-create'))

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
      const user = userEvent.setup()
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

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()
      expect(screen.getByTestId('try-app-create')).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )
    })

    it('should close the Learn Dify detail when the home action guide is skipped', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
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

      renderAppList(true, undefined, undefined, {
        extra: <SkipHomeGuideProbe />,
        deploymentEdition: 'CLOUD',
      })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()
      expect(screen.getByTestId('try-app-create')).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )

      await user.click(screen.getByTestId('skip-home-guide'))

      await waitFor(() => {
        expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()
      })
    })

    it('should complete the Learn Dify tour when a no-create user opens a lesson detail', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        minimized: true,
      })

      renderAppList(false, undefined, undefined, { deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('try-app-create')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(mockStepByStepTour.patchState.mock.calls.at(-1)?.[0]).toEqual({
          body: {
            action: 'complete_task',
            task_id: 'home',
          },
        })
      })
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'task_completed',
        completed_task_count: 1,
        home_outcome: 'lesson_opened',
        permission_variant: 'no_create',
        task_id: 'home',
        task_total: 4,
      })
    })

    it('should complete the Learn Dify tour only after the app is created from details', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
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
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml-content',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (
          _payload: unknown,
          options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void },
        ) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByTestId('try-app-create'))
      await user.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(mockStepByStepTour.patchState.mock.calls.at(-1)?.[0]).toEqual({
          body: {
            action: 'complete_task',
            task_id: 'home',
          },
        })
      })
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'task_completed',
        completed_task_count: 1,
        home_outcome: 'lesson_app_created',
        permission_variant: 'full',
        task_id: 'home',
        task_total: 4,
      })
      expect(mockHandleImportDSL).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          skipRedirectOnSuccess: true,
        }),
      )
    })

    it('should clear the Learn Dify session and provenance when completion persistence fails', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
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
      mockStepByStepTour.patchState.mockRejectedValueOnce(new Error('patch failed'))
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml-content',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (
          _payload: unknown,
          options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void },
        ) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByTestId('try-app-create'))
      await user.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(mockStepByStepTour.patchState).toHaveBeenCalledTimes(1)
      })
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        'step_tour',
        expect.objectContaining({
          action: 'task_completed',
          home_outcome: 'lesson_app_created',
        }),
      )

      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await user.click(await screen.findByTestId('try-app-create'))
      await user.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(mockHandleImportDSL).toHaveBeenCalledTimes(2)
      })
      expect(mockHandleImportDSL).toHaveBeenLastCalledWith(
        expect.any(Object),
        expect.objectContaining({
          skipRedirectOnSuccess: false,
        }),
      )
      expect(mockStepByStepTour.patchState).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        'step_tour',
        expect.objectContaining({
          action: 'task_completed',
          home_outcome: 'lesson_app_created',
        }),
      )
    })

    it('should skip redirect after confirming a pending Learn Dify tour create', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockStepByStepTour.setUiState({
        activeTaskId: 'home',
        activeGuideIndex: 0,
        minimized: true,
      })
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml-content',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (_payload: unknown, options: { onPending?: () => void }) => {
          options.onPending?.()
        },
      )
      mockHandleImportDSLConfirm.mockImplementation(
        async (options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByTestId('try-app-create'))
      await user.click(await screen.findByTestId('confirm-create'))
      await user.click(await screen.findByTestId('dsl-confirm'))

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
      const user = userEvent.setup()
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

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      const createFromDetailsButton = await screen.findByTestId('try-app-create')
      expect(createFromDetailsButton).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )

      await user.click(createFromDetailsButton)
      expect(await screen.findByTestId('create-app-modal')).toBeInTheDocument()
      expect(createFromDetailsButton).not.toHaveAttribute('data-step-by-step-tour-target')

      await user.click(screen.getByTestId('hide-create'))

      await waitFor(() => {
        expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should reset search results when clear icon is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [
          createApp(),
          createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } }),
        ],
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

    it('should preserve settled middle content and retry templates when templates fail', async () => {
      vi.useRealTimers()
      mockIsError = true
      mockExploreData = undefined
      mockWorkspaceApps = [createWorkspaceApp({ name: 'Available Continue Work' })]

      renderAppList()

      expect(await screen.findByText('Available Continue Work')).toBeInTheDocument()
      expect(await screen.findByRole('alert')).toBeInTheDocument()

      mockIsError = false
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      ;(fetchAppList as unknown as Mock).mockResolvedValue({
        categories: mockExploreData.categories,
        recommended_apps: mockExploreData.allList,
      })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      expect(await screen.findByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('should keep only the templates skeleton after middle settles first', () => {
      mockExploreData = undefined
      mockIsLoading = true

      renderAppList()

      expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
    })

    it('should close create modal via hide button', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml',
        mode: AppModeEnum.CHAT,
      })

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
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (
          _payload: unknown,
          options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void },
        ) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

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
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (_payload: unknown, options: { onPending?: () => void }) => {
          options.onPending?.()
        },
      )

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

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

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
      }
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({
        export_data: 'yaml',
        mode: AppModeEnum.CHAT,
      })
      mockHandleImportDSL.mockImplementation(
        async (
          _payload: unknown,
          options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void },
        ) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

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

      renderAppList(true, undefined, undefined, { deploymentEdition: 'CLOUD' })

      fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      expect(await screen.findByTestId('try-app-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('try-app-close'))
      expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()
    })
  })
})
