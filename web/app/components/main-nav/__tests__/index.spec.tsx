import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { GetVersionResponse } from '@dify/contracts/api/console/version/types.gen'
import type {
  GetWorkspacesCurrentSummaryResponse,
  TenantListItemResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { DETAIL_SIDEBAR_STORAGE_KEY } from '@/app/components/detail-sidebar/storage'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '@/app/components/explore/learn-dify/storage'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import {
  stepByStepTourSessionAtom,
  stepByStepTourSkipRecoveryVisibleAtom,
} from '@/app/components/step-by-step-tour/state'
import { STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY } from '@/app/components/step-by-step-tour/storage'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { AppModeEnum } from '@/types/app'
import { MainNav } from '../index'

type StepByStepTourTestUiState = StepByStepTourSessionState & { minimized: boolean }

const activeGradientMaskClassName = 'aria-[current=page]:dify-blue-glass-surface'
const activeStackingClassName = 'aria-[current=page]:z-1'
const mockTrackEvent = vi.hoisted(() => vi.fn())

const {
  mockFetchNextInstalledAppsPage,
  mockInstalledAppsRequest,
  mockIsAgentV2Enabled,
  mockSwitchWorkspace,
  mockToastSuccess,
  mockUninstall,
  mockUpdatePinStatus,
} = vi.hoisted(() => ({
  mockFetchNextInstalledAppsPage: vi.fn(),
  mockInstalledAppsRequest: vi.fn(),
  mockIsAgentV2Enabled: vi.fn(() => true),
  mockSwitchWorkspace: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockUninstall: vi.fn(),
  mockUpdatePinStatus: vi.fn(),
}))
const mockStepByStepTour = vi.hoisted(() => {
  const stateQueryKey = ['console', 'onboarding', 'step-by-step-tour', 'state'] as const
  const createState = (
    overrides: Partial<StepByStepTourStateResponse> = {},
  ): StepByStepTourStateResponse => ({
    first_workspace_id: 'workspace-1',
    skipped: false,
    completed_task_ids: [],
    manually_enabled_workspace_ids: [],
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
  let uiState = createUiState()
  const patchState = vi.fn(
    async ({
      body,
    }: {
      body: StepByStepTourStatePatchPayload
    }): Promise<StepByStepTourStateResponse> => {
      switch (body.action) {
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
        case 'skip':
          state = {
            ...state,
            skipped: true,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
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
      if (overrides.minimized !== undefined) {
        localStorage.setItem(
          STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY,
          overrides.minimized ? 'collapsed' : 'expanded',
        )
      }
    },
    stateQueryKey,
  }
})
type MainNavConsoleState = ConsoleStateFixture & {
  profileMeta: UserProfileWithMeta['meta']
  versionData: GetVersionResponse
}

const mockConsoleState = vi.hoisted(() => ({
  current: undefined as MainNavConsoleState | undefined,
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mockTrackEvent,
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current ?? {})
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current ?? {})
})
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
  useModalContextSelector: <T,>(selector: (state: { hasBlockingModalOpen: boolean }) => T) =>
    selector({
      hasBlockingModalOpen: false,
    }),
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
    useRouter: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'common.stepByStepTour.title': 'Get to know Dify',
      'common.stepByStepTour.duration': 'A quick tour — about 5 minutes',
      'common.stepByStepTour.skip': 'Skip tour',
      'common.stepByStepTour.minimize': 'Minimize tour',
      'common.stepByStepTour.restore': 'Open step-by-step tour',
      'common.stepByStepTour.learnMore': 'Learn more',
      'common.stepByStepTour.skipRecovery.label': 'Step-by-step Tour recovery tip',
      'common.stepByStepTour.skipRecovery.message':
        'Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.',
      'common.stepByStepTour.skipRecovery.dismiss': 'Got it',
      'common.stepByStepTour.tasks.home.title': 'Try a Learn Dify lesson',
      'common.stepByStepTour.tasks.home.description':
        'Open a hands-on lesson from Learn Dify to see Dify in action.',
      'common.stepByStepTour.tasks.home.primaryActionLabel': 'Show me',
      'common.stepByStepTour.tasks.studio.title': 'Manage your apps in Studio',
      'common.stepByStepTour.tasks.studio.description':
        'All your apps live in Studio — edit, organize, and publish them here.',
      'common.stepByStepTour.tasks.studio.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.knowledge.title': 'Add your own data',
      'common.stepByStepTour.tasks.knowledge.description':
        'Build a knowledge base so your apps answer from your documents.',
      'common.stepByStepTour.tasks.knowledge.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.integration.title': 'Explore integrations',
      'common.stepByStepTour.tasks.integration.description':
        'Models, tools, data sources & more — explore what you can connect.',
      'common.stepByStepTour.tasks.integration.primaryActionLabel': 'Take a look',
    }),
  }
})

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const currentWorkspaceQueryKey = ['console', 'workspaces', 'current', 'summary', 'get'] as const
  const currentPermissionsQueryKey = [
    ['console', 'workspaces', 'current', 'rbac', 'myPermissions', 'get'],
    { type: 'query' },
  ] as const
  const workspacesQueryKey = ['console', 'workspaces', 'get'] as const
  const consoleQuery = new Proxy(actual.consoleQuery, {
    get(target, prop, receiver) {
      if (prop === 'workspaces') {
        return {
          current: {
            summary: {
              get: {
                key: () => currentWorkspaceQueryKey,
                queryKey: () => currentWorkspaceQueryKey,
                queryOptions: (options?: object) => ({
                  queryKey: currentWorkspaceQueryKey,
                  queryFn: () => new Promise(() => {}),
                  ...options,
                }),
              },
            },
            rbac: {
              myPermissions: {
                get: {
                  queryOptions: () => ({
                    queryKey: currentPermissionsQueryKey,
                    queryFn: () => new Promise(() => {}),
                  }),
                },
              },
            },
          },
          get: {
            queryKey: () => workspacesQueryKey,
            queryOptions: () => ({
              queryKey: workspacesQueryKey,
              queryFn: () => new Promise(() => {}),
            }),
          },
          switch: {
            post: {
              mutationOptions: () => ({
                mutationFn: (variables: unknown) => mockSwitchWorkspace(variables),
              }),
            },
          },
        }
      }
      if (prop === 'onboarding') {
        return {
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
        }
      }
      if (prop === 'installedApps') {
        return {
          get: {
            infiniteOptions: (options: {
              getNextPageParam: (page: {
                has_more: boolean
                next_cursor: string | null
              }) => string | undefined
              initialPageParam: undefined
              input: (pageParam: string | undefined) => {
                query: { cursor?: string; limit: number; name?: string }
              }
              placeholderData?: unknown
              select?: (data: unknown) => unknown
            }) => ({
              ...options,
              queryKey: ['installed-apps', options.input(undefined).query.name ?? ''],
              queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
                mockInstalledAppsRequest(options.input(pageParam)),
            }),
          },
          byInstalledAppId: {
            delete: {
              mutationOptions: () => ({
                mutationFn: (input: unknown) => mockUninstall(input),
              }),
            },
            patch: {
              mutationOptions: () => ({
                mutationFn: (input: unknown) => mockUpdatePinStatus(input),
              }),
            },
          },
        }
      }

      return Reflect.get(target, prop, receiver)
    },
  })

  return {
    ...actual,
    consoleQuery,
  }
})

vi.mock('@langgenius/dify-ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langgenius/dify-ui/toast')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
    },
  }
})

vi.mock('@/app/components/header/github-star', () => ({
  default: ({ className }: { className?: string }) => <span className={className}>1,234</span>,
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/next/dynamic', async () => {
  const { default: WebAppsSection } = await import('../components/web-apps-section')

  return {
    default: () => WebAppsSection,
  }
})

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    SUPPORT_EMAIL_ADDRESS: '',
    ZENDESK_WIDGET_KEY: '',
  }
})

const mockPush = vi.fn()
const mockSetShowPricingModal = vi.fn()
const mockSetSettingsDestination = vi.fn()
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})
let mockPathname = '/apps'
let mockInstalledApps: InstalledAppResponse[] = []
let mockInstalledAppsPending = false
let mockInstalledAppsHasNextPage = false
let mockWorkspaces: TenantListItemResponse[] = []

function stubScrollRootIntersectionObserver() {
  const observers: Array<{
    callback: IntersectionObserverCallback
    root: Element | Document | null | undefined
  }> = []
  vi.stubGlobal(
    'IntersectionObserver',
    class MockIntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback: nextCallback, root: options?.root })
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )

  return async () => {
    await waitFor(() => {
      expect(observers.some(({ root }) => root instanceof Element)).toBe(true)
    })
    const observer = observers.find(({ root }) => root instanceof Element)
    if (!observer) throw new Error('The scroll root observer was not created')

    act(() => {
      observer.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
  }
}

const ownerWorkspacePermissionKeys = [
  'workspace.member.manage',
  'workspace.role.manage',
  'app_library.access',
  'app.create_and_management',
  'dataset.create_and_management',
  'dataset.external.connect',
  'tool.manage',
  'mcp.manage',
  'agent.manage',
]

const datasetOperatorWorkspacePermissionKeys = [
  'plugin.install',
  'dataset.create_and_management',
  'dataset.external.connect',
]

const createInstalledApp = (
  overrides: Partial<InstalledAppResponse> = {},
): InstalledAppResponse => ({
  id: overrides.id ?? 'installed-1',
  app_owner_tenant_id: overrides.app_owner_tenant_id ?? 'tenant-1',
  editable: overrides.editable ?? true,
  last_used_at: overrides.last_used_at ?? null,
  uninstallable: overrides.uninstallable ?? false,
  is_pinned: overrides.is_pinned ?? false,
  app: {
    id: overrides.app?.id ?? 'app-1',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '🤖',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? null,
    name: overrides.app?.name ?? 'Alpha App',
    description: overrides.app?.description ?? '',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
})

const mainNavUserProfile = {
  id: 'user-1',
  name: 'Evan Z',
  email: 'evan@example.com',
  avatar: '',
  avatar_url: '',
  is_password_set: true,
}

const consoleState: MainNavConsoleState = {
  userProfile: mainNavUserProfile,
  currentWorkspace: {
    id: 'workspace-1',
    name: 'Solar Studio',
    plan: 'team',
    credits: 7500,
    role: 'owner',
  },
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceDatasetOperator: false,
  refreshCurrentWorkspace: vi.fn(),
  profileMeta: {
    currentEnv: 'testing',
    currentVersion: '1.0.0',
  },
  versionData: {
    version: '1.0.0',
    release_notes: '',
  },
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  workspacePermissionKeys: ownerWorkspacePermissionKeys,
}

type MainNavSystemFeatures = Exclude<
  NonNullable<Parameters<typeof renderWithConsoleQuery>[1]>['systemFeatures'],
  null | undefined
>

const defaultMainNavSystemFeatures: MainNavSystemFeatures = {
  deployment_edition: 'CLOUD',
  branding: { enabled: false },
  enable_marketplace: true,
  enable_step_by_step_tour: true,
}

const renderMainNav = (
  systemFeatures: MainNavSystemFeatures = defaultMainNavSystemFeatures,
  options: {
    store?: ReturnType<typeof createStore>
    extra?: ReactNode
    educationStatus?: NonNullable<Parameters<typeof renderWithConsoleQuery>[1]>['educationStatus']
    skipRecoveryVisible?: boolean
  } = {},
) => {
  const queryClient = createConsoleQueryClient()
  const currentConsoleState = mockConsoleState.current ?? consoleState
  mockConsoleState.current = currentConsoleState
  queryClient.setQueryData(
    consoleQuery.workspaces.current.summary.get.queryKey(),
    currentConsoleState.currentWorkspace as GetWorkspacesCurrentSummaryResponse,
  )
  queryClient.setQueryData(userProfileQueryOptions().queryKey, {
    profile: {
      ...mainNavUserProfile,
      ...(currentConsoleState.userProfile ?? {}),
    },
    meta: {
      currentVersion: currentConsoleState.profileMeta.currentVersion,
      currentEnv: currentConsoleState.profileMeta.currentEnv,
    },
  })
  const currentVersion = currentConsoleState.profileMeta.currentVersion
  if (currentVersion) {
    queryClient.setQueryData(
      consoleQuery.version.get.queryOptions({
        input: { query: { current_version: currentVersion } },
      }).queryKey,
      currentConsoleState.versionData,
    )
  }
  queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })
  queryClient.setQueryData(mockStepByStepTour.stateQueryKey, mockStepByStepTour.state)
  const store = options.store ?? createStore()
  seedRegisteredConsoleStateFixture(store)
  store.set(queryClientAtom, queryClient)
  store.set(stepByStepTourSessionAtom, mockStepByStepTour.uiState)
  if (options.skipRecoveryVisible !== undefined)
    store.set(stepByStepTourSkipRecoveryVisibleAtom, options.skipRecoveryVisible)
  const resolvedSystemFeatures = {
    ...defaultMainNavSystemFeatures,
    ...systemFeatures,
    branding: {
      ...defaultMainNavSystemFeatures.branding,
      ...systemFeatures.branding,
    },
  }
  return renderWithConsoleQuery(
    <JotaiProvider store={store}>
      <MainNav />
      {options.extra}
    </JotaiProvider>,
    {
      systemFeatures: resolvedSystemFeatures,
      educationStatus: options.educationStatus,
      workspacePermissionKeys: currentConsoleState.workspacePermissionKeys,
      queryClient,
    },
  )
}

describe('MainNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gotoAnythingDialogHandle.close()
    localStorage.clear()
    mockPathname = '/apps'
    mockInstalledApps = []
    mockInstalledAppsPending = false
    mockInstalledAppsHasNextPage = false
    mockWorkspaces = [
      {
        id: 'workspace-1',
        name: 'Solar Studio',
        plan: 'team',
        status: 'normal',
        created_at: 0,
        current: true,
      },
      {
        id: 'workspace-2',
        name: 'Evan Workspace',
        plan: 'sandbox',
        status: 'normal',
        created_at: 0,
        current: false,
      },
    ]
    mockStepByStepTour.reset()
    mockIsAgentV2Enabled.mockReturnValue(true)

    ;(usePathname as Mock).mockImplementation(() => mockPathname)
    ;(useRouter as Mock).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    })
    mockConsoleState.current = consoleState
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      enableEducationPlan: false,
      isFetchedPlan: true,
      plan: { type: 'sandbox' },
    } as ProviderContextState)
    ;(useModalContext as Mock).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
    } as unknown as ModalContextState)
    mockInstalledAppsRequest.mockImplementation(
      async ({ query }: { query: { cursor?: string; name?: string } }) => {
        if (mockInstalledAppsPending) return new Promise(() => {})
        if (query.cursor) {
          mockFetchNextInstalledAppsPage(query.cursor)
          return { installed_apps: [], has_more: false, next_cursor: null }
        }

        const installedApps = query.name
          ? mockInstalledApps.filter((installedApp) =>
              installedApp.app.name.toLowerCase().includes(query.name!.toLowerCase()),
            )
          : mockInstalledApps
        return {
          installed_apps: installedApps,
          has_more: mockInstalledAppsHasNextPage,
          next_cursor: mockInstalledAppsHasNextPage ? 'next-page' : null,
        }
      },
    )
    mockUninstall.mockResolvedValue(undefined)
    mockUpdatePinStatus.mockResolvedValue({ result: 'success', message: 'updated' })
    mockSwitchWorkspace.mockReturnValue(new Promise(() => {}))
  })

  it('renders primary navigation with the planned routes', () => {
    renderMainNav()

    expect(screen.getAllByText('team')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'common.account.account' })).not.toHaveTextContent(
      'team',
    )
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toHaveAttribute('href', '/apps')
    expect(screen.getByRole('link', { name: /Agents/ })).toHaveAttribute('href', '/agents')
    expect(screen.getByRole('link', { name: /Agents common.menus.status/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toHaveAttribute(
      'href',
      '/integrations/model-provider',
    )
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toHaveAttribute(
      'href',
      '/marketplace',
    )
  })

  it('hides the roster entry when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)

    renderMainNav()

    expect(screen.queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
  })

  it('hides the roster entry when the user lacks agent.manage', () => {
    mockConsoleState.current = {
      ...consoleState,
      workspacePermissionKeys: ownerWorkspacePermissionKeys.filter((key) => key !== 'agent.manage'),
    }

    renderMainNav()

    expect(screen.queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
  })

  it('shows the roster entry when the user has agent.manage', () => {
    renderMainNav()

    expect(screen.getByRole('link', { name: /Agents/ })).toBeInTheDocument()
  })

  it('hides the marketplace entry when marketplace is disabled', () => {
    renderMainNav({ enable_marketplace: false })

    expect(
      screen.queryByRole('link', { name: /common.mainNav.marketplace/ }),
    ).not.toBeInTheDocument()
  })

  it('orders the Step-by-step Tour before the account and help actions', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY, 'collapsed')

    renderMainNav()

    const tourTrigger = await screen.findByRole('button', { name: 'Open step-by-step tour' })
    const accountButton = screen.getByRole('button', { name: 'common.account.account' })
    const helpButton = screen.getByRole('button', { name: 'common.mainNav.help.openMenu' })

    expect(tourTrigger.compareDocumentPosition(accountButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(accountButton.compareDocumentPosition(helpButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('keeps the global navigation account section expanded on home routes', () => {
    localStorage.setItem(DETAIL_SIDEBAR_STORAGE_KEY, 'collapse')
    mockPathname = '/'

    renderMainNav()

    const accountButton = screen.getByRole('button', { name: 'common.account.account' })
    expect(accountButton).toHaveTextContent('Evan Z')
    expect(accountButton).toHaveClass('max-w-45', 'gap-3', 'py-1', 'pr-4', 'pl-1')
    expect(accountButton).not.toHaveClass('justify-center', 'p-1')
  })

  it('does not reserve environment tag space when the environment is not shown', () => {
    const { container } = renderMainNav()

    expect(screen.queryByText('common.environment.testing')).not.toBeInTheDocument()
    expect(screen.queryByText('common.environment.development')).not.toBeInTheDocument()
    expect(container.querySelector('.relative.z-30')).not.toBeInTheDocument()
  })

  it('shows the user education badge in the account popup without adding the workspace plan there', async () => {
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      enableEducationPlan: true,
      isFetchedPlan: true,
      plan: { type: 'sandbox' },
    } as ProviderContextState)

    renderMainNav(defaultMainNavSystemFeatures, {
      educationStatus: { is_student: true },
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.account.account' }))

    expect(await screen.findByText('EDU')).toBeInTheDocument()
    expect(screen.getByText('evan@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('team')).toHaveLength(1)
  })

  it('keeps unrestricted main routes visible for dataset operators while hiding roster', () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        role: 'dataset_operator',
      },
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: datasetOperatorWorkspacePermissionKeys,
    }

    renderMainNav()

    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toHaveAttribute('href', '/apps')
    expect(screen.queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toHaveAttribute(
      'href',
      '/integrations/model-provider',
    )
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toHaveAttribute(
      'href',
      '/marketplace',
    )
    expect(
      screen.queryByRole('button', { name: 'explore.sidebar.webApps' }),
    ).not.toBeInTheDocument()
  })

  it('keeps unrestricted main routes visible without route permission keys', () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        role: 'normal',
      },
      isCurrentWorkspaceDatasetOperator: false,
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: ['app_library.access', 'tool.manage', 'agent.manage'],
    }

    renderMainNav({ branding: { enabled: false } })

    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Agents/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toBeInTheDocument()
  })

  it('marks the matching primary route active', () => {
    mockPathname = '/datasets'

    renderMainNav()

    const datasetsLink = screen.getByRole('link', { name: /common.menus.datasets/ })
    expect(datasetsLink).toHaveClass(activeGradientMaskClassName)
    expect(datasetsLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps Studio active on snippets routes', () => {
    mockPathname = '/snippets'

    renderMainNav()

    const studioLink = screen.getByRole('link', { name: /common.menus.apps/ })
    expect(studioLink).toHaveClass(activeGradientMaskClassName)
    expect(studioLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps roster detail navigation hidden when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)
    mockPathname = '/agents/agent-1/configure'

    renderMainNav()

    expect(screen.queryByTestId('agent-detail-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-detail-section')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
  })

  it('keeps MainNav on primary navigation when it is mounted on a detail route', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()

    expect(screen.queryByTestId('app-detail-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('app-detail-section')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toHaveAttribute('href', '/apps')
  })

  it.each([
    '/datasets/create',
    '/datasets/create-from-pipeline',
    '/datasets/connect',
    '/datasets/dataset-1/documents/create',
    '/datasets/dataset-1/documents/create-from-pipeline',
  ])('keeps global navigation on dataset creation route %s', (pathname) => {
    mockPathname = pathname

    renderMainNav()

    expect(screen.queryByTestId('dataset-detail-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dataset-detail-section')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute(
      'href',
      '/datasets',
    )
  })

  it('marks marketplace active on marketplace routes', () => {
    mockPathname = '/marketplace'

    renderMainNav()

    const marketplaceLink = screen.getByRole('link', { name: /common.mainNav.marketplace/ })
    expect(marketplaceLink).toHaveClass(activeGradientMaskClassName)
  })

  it('marks roster active on roster routes', () => {
    mockPathname = '/agents'

    renderMainNav()

    const rosterLink = screen.getByRole('link', { name: /Agents/ })
    expect(rosterLink).toHaveClass(activeGradientMaskClassName)
    expect(rosterLink).toHaveAttribute('aria-current', 'page')
  })

  it('applies the Figma glass active state to the Home route', () => {
    mockPathname = '/'

    renderMainNav()

    const homeLink = screen.getByRole('link', { name: /common.mainNav.home/ })

    expect(homeLink).toHaveClass(activeGradientMaskClassName)
    expect(homeLink).toHaveClass(activeStackingClassName)
  })

  it('opens goto anything from the search button', async () => {
    renderMainNav(undefined, {
      extra: (
        <Dialog handle={gotoAnythingDialogHandle}>
          <DialogContent>
            <DialogTitle>Goto Anything</DialogTitle>
          </DialogContent>
        </Dialog>
      ),
    })

    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(await screen.findByRole('dialog', { name: 'Goto Anything' })).toBeInTheDocument()
  })

  it('shows Learn Dify switch in help menu and restores it from localStorage', async () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderMainNav({ enable_learn_app: true })

    const helpTrigger = screen.getByRole('button', { name: 'common.mainNav.help.openMenu' })
    expect(helpTrigger).not.toHaveAttribute('data-popup-open')

    fireEvent.click(helpTrigger)

    expect(helpTrigger).toHaveAttribute('data-popup-open', '')
    const learnDifyItem = await screen.findByRole('menuitemcheckbox', {
      name: 'common.mainNav.help.learnDify',
    })
    expect(learnDifyItem).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(learnDifyItem)

    await waitFor(() => {
      expect(localStorage.getItem(LEARN_DIFY_HIDDEN_STORAGE_KEY)).toBe('false')
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('keeps focus in the help menu when it dismisses the recovery prompt', async () => {
    const user = userEvent.setup()
    mockStepByStepTour.setState({ skipped: true })
    renderMainNav(undefined, { skipRecoveryVisible: true })

    expect(
      await screen.findByRole('dialog', { name: 'Step-by-step Tour recovery tip' }),
    ).toBeInTheDocument()

    const helpTrigger = screen.getByRole('button', { name: 'common.mainNav.help.openMenu' })
    await user.click(helpTrigger)

    expect(
      screen.queryByRole('dialog', { name: 'Step-by-step Tour recovery tip' }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('menu')).toHaveFocus()
    })
  })

  it('shows Step-by-step Tour switch in help menu and stores the current workspace disable override', async () => {
    const user = userEvent.setup()
    renderMainNav({ enable_learn_app: true })

    await user.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    const stepByStepTourItem = await screen.findByRole('menuitemcheckbox', {
      name: 'common.mainNav.help.stepByStepTour',
    })
    expect(stepByStepTourItem).toHaveAttribute('aria-checked', 'true')

    await user.click(stepByStepTourItem)

    await waitFor(() => {
      expect(mockStepByStepTour.patchState.mock.calls[0]?.[0]).toEqual({
        body: { action: 'disable_current_workspace' },
      })
    })
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', { action: 'tour_disabled' })
  })

  it('shows Step-by-step Tour switch off for existing accounts without a default workspace', async () => {
    const user = userEvent.setup()
    mockStepByStepTour.setState({
      first_workspace_id: null,
      manually_enabled_workspace_ids: [],
      manually_disabled_workspace_ids: [],
    })

    renderMainNav({ enable_learn_app: true })

    await user.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))

    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'common.mainNav.help.stepByStepTour' }),
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('closes the help menu and opens Step-by-step Tour when enabling it', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY, 'collapsed')
    mockStepByStepTour.setState({
      first_workspace_id: null,
      manually_enabled_workspace_ids: [],
      manually_disabled_workspace_ids: [],
    })

    renderMainNav({ enable_learn_app: true })

    await user.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    const stepByStepTourItem = await screen.findByRole('menuitemcheckbox', {
      name: 'common.mainNav.help.stepByStepTour',
    })
    expect(stepByStepTourItem).toHaveAttribute('aria-checked', 'false')

    await user.click(stepByStepTourItem)

    await waitFor(() => {
      expect(mockStepByStepTour.patchState.mock.lastCall?.[0]).toEqual({
        body: { action: 'enable_current_workspace' },
      })
      expect(localStorage.getItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY)).toBe('expanded')
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', { action: 'tour_enabled' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('dialog', { name: 'Get to know Dify' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'common.mainNav.help.stepByStepTour' }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('hides Step-by-step Tour switch when the feature is disabled', async () => {
    const user = userEvent.setup()
    renderMainNav({
      enable_learn_app: true,
      enable_step_by_step_tour: false,
    })

    await user.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))

    await screen.findByText('common.mainNav.help.docs')
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'common.mainNav.help.stepByStepTour' }),
    ).not.toBeInTheDocument()
  })

  it('hides Learn Dify switch in help menu when learn app is disabled', async () => {
    renderMainNav({ enable_learn_app: false })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))

    await screen.findByText('common.mainNav.help.docs')
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'common.mainNav.help.learnDify' }),
    ).not.toBeInTheDocument()
  })

  it('orders help menu items to match the nav shell design', async () => {
    renderMainNav({ enable_learn_app: true })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))

    const labels = [
      'common.mainNav.help.docs',
      'common.userProfile.roadmap',
      'common.mainNav.help.learnDify',
      'common.mainNav.help.stepByStepTour',
      'common.userProfile.compliance',
      'common.userProfile.forum',
      'common.userProfile.community',
      'common.userProfile.github',
      'common.userProfile.about',
    ]
    const nodes = await Promise.all(labels.map((label) => screen.findByText(label)))

    nodes.slice(1).forEach((node, index) => {
      expect(nodes[index]!.compareDocumentPosition(node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })
  })

  it('opens About from its real Help menu owner and restores focus when closed', async () => {
    const user = userEvent.setup()
    mockConsoleState.current = {
      ...consoleState,
      versionData: {
        version: '1.1.0',
        release_notes: 'https://github.com/langgenius/dify/releases/tag/1.1.0',
      },
    }
    renderMainNav()

    const helpButton = screen.getByRole('button', { name: 'common.mainNav.help.openMenu' })
    await user.click(helpButton)
    await user.click(await screen.findByRole('menuitem', { name: /common\.userProfile\.about/ }))

    expect(
      await screen.findByRole('dialog', { name: 'common.userProfile.about' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://dify.ai/privacy',
    )
    expect(screen.getByRole('link', { name: 'common.about.changeLog' })).toHaveAttribute(
      'href',
      'https://github.com/langgenius/dify/releases',
    )
    expect(screen.getByRole('link', { name: 'common.about.updateNow' })).toHaveAttribute(
      'href',
      'https://github.com/langgenius/dify/releases/tag/1.1.0',
    )
    expect(screen.queryByRole('button', { name: 'common.about.changeLog' })).not.toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'common.userProfile.about' }),
      ).not.toBeInTheDocument()
      expect(helpButton).toHaveFocus()
    })
  })

  it('shows the open-source license in About for non-Cloud editions', async () => {
    const user = userEvent.setup()
    renderMainNav({ deployment_edition: 'COMMUNITY' })

    await user.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    await user.click(await screen.findByRole('menuitem', { name: /common\.userProfile\.about/ }))

    expect(await screen.findByRole('link', { name: 'Open Source License' })).toHaveAttribute(
      'href',
      'https://github.com/langgenius/dify/blob/main/LICENSE',
    )
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument()
  })

  it('closes the help menu from the support upgrade action', async () => {
    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    const contactUsItem = await screen.findByRole('menuitem', {
      name: 'common.userProfile.contactUs billing.upgradeBtn.encourageShort',
    })
    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()

    fireEvent.click(contactUsItem)

    await waitFor(() => {
      expect(screen.queryByText('common.userProfile.forum')).not.toBeInTheDocument()
    })
    expect(mockSetShowPricingModal).toHaveBeenCalled()
  })

  it('hides the help menu when branding is enabled', () => {
    renderMainNav({ branding: { enabled: true } }, { skipRecoveryVisible: true })

    expect(
      screen.queryByRole('button', { name: 'common.mainNav.help.openMenu' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'Step-by-step Tour recovery tip' }),
    ).not.toBeInTheDocument()
  })

  it('opens workspace settings, members, plan, and workspace switching actions', async () => {
    renderMainNav()

    expect(
      screen.getByRole('link', { name: /common\.mainNav\.workspace\.credits|7,500 credits/ }),
    ).toHaveAttribute('href', '/integrations/model-provider')
    expect(mockSetSettingsDestination).not.toHaveBeenCalledWith('provider')

    fireEvent.click(screen.getByText('billing.upgradeBtn.plain'))
    expect(mockSetShowPricingModal).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByText('common.mainNav.workspace.settings'))
    expect(mockSetSettingsDestination).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.BILLING)

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByText('common.mainNav.workspace.inviteMembers'))
    expect(mockSetSettingsDestination).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.MEMBERS)

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByText('Evan Workspace'))
    await waitFor(() => {
      expect(mockSwitchWorkspace).toHaveBeenCalledWith({ body: { tenant_id: 'workspace-2' } })
    })
  })

  it('shows the upgrade shortcut for sandbox workspaces', () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        plan: 'sandbox',
      },
    }

    renderMainNav()

    expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.plain')).not.toBeInTheDocument()
  })

  it('shows the view plan shortcut for paid workspaces', () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        plan: 'professional',
      },
    }

    renderMainNav()

    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('billing.upgradeBtn.plain'))
    expect(mockSetShowPricingModal).toHaveBeenCalled()
    expect(mockSetSettingsDestination).not.toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.BILLING)
  })

  it('limits invite members by member management permission', async () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        role: 'normal',
      },
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: ownerWorkspacePermissionKeys.filter(
        (key) => key !== 'workspace.member.manage',
      ),
    }

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByText('common.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('common.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('keeps workspace settings visible and hides invite members without member management permission', () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        role: 'dataset_operator',
      },
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: datasetOperatorWorkspacePermissionKeys,
    }

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(screen.getByText('common.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('common.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('searches installed web apps and renders the matching navigation link', async () => {
    const user = userEvent.setup()
    mockInstalledApps = [
      createInstalledApp({
        id: 'installed-1',
        app: { ...createInstalledApp().app, name: 'Alpha App' },
      }),
      createInstalledApp({
        id: 'installed-2',
        app: { ...createInstalledApp().app, name: 'Beta Tool' },
      }),
    ]

    renderMainNav()

    const scrollViewport = await screen.findByRole('region', {
      name: 'explore.sidebar.webApps',
    })
    scrollViewport.scrollTop = 240
    scrollViewport.scrollTo = (optionsOrX?: ScrollToOptions | number, y?: number) => {
      const top = typeof optionsOrX === 'object' ? optionsOrX.top : y
      scrollViewport.scrollTop = Number(top ?? 0)
    }
    const searchButton = await screen.findByRole('button', { name: 'common.operation.search' })
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(searchButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')

    const searchInput = screen.getByPlaceholderText('common.mainNav.webApps.searchPlaceholder')
    await user.type(searchInput, 'beta')

    await waitFor(() => {
      expect(scrollViewport.scrollTop).toBe(0)
      expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()
      expect(screen.getByText('Beta Tool')).toBeInTheDocument()
    })
    expect(searchInput).toHaveFocus()
    expect(
      screen.getByRole('link', { name: 'common.mainNav.webApps.openApp:{"name":"Beta Tool"}' }),
    ).toHaveAttribute('href', '/installed/installed-2')

    const webAppsButton = screen.getByRole('button', { name: 'explore.sidebar.webApps' })
    await user.click(webAppsButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByPlaceholderText('common.mainNav.webApps.searchPlaceholder'),
    ).not.toBeInTheDocument()

    await user.click(webAppsButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByPlaceholderText('common.mainNav.webApps.searchPlaceholder')).toHaveValue(
      'beta',
    )
  })

  it('hides the installed web apps section while installed apps are loading', () => {
    mockInstalledAppsPending = true

    renderMainNav()

    expect(
      screen.queryByRole('region', { name: 'explore.sidebar.webApps' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'explore.sidebar.webApps' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.search' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()
  })

  it('hides the installed web apps section when no web apps are available', async () => {
    renderMainNav()

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'explore.sidebar.webApps' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'explore.sidebar.webApps' }),
      ).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: 'common.operation.search' }),
    ).not.toBeInTheDocument()
  })

  it('separates pinned and unpinned installed web apps', async () => {
    mockInstalledApps = [
      createInstalledApp({
        id: 'installed-1',
        is_pinned: true,
        app: { ...createInstalledApp().app, name: 'Pinned App' },
      }),
      createInstalledApp({
        id: 'installed-2',
        is_pinned: false,
        app: { ...createInstalledApp().app, name: 'Unpinned App' },
      }),
    ]

    renderMainNav()

    expect(await screen.findByText('Pinned App')).toBeInTheDocument()
    expect(screen.getByText('Unpinned App')).toBeInTheDocument()
    expect(screen.getByTestId('divider')).toBeInTheDocument()
  })

  it('keeps long installed web app names truncated in the main nav item', async () => {
    const longName = 'A very long installed web app name that should stay on one line and truncate'
    mockInstalledApps = [
      createInstalledApp({
        id: 'installed-1',
        app: { ...createInstalledApp().app, name: longName },
      }),
    ]

    renderMainNav()

    expect(await screen.findByText(longName)).toHaveClass('truncate')
  })

  it('fetches the next installed web app page when the bottom sentinel enters the viewport', async () => {
    const triggerIntersection = stubScrollRootIntersectionObserver()
    mockInstalledApps = [createInstalledApp()]
    mockInstalledAppsHasNextPage = true
    renderMainNav()
    await screen.findByText('Alpha App')

    await triggerIntersection()

    await waitFor(() => {
      expect(mockFetchNextInstalledAppsPage).toHaveBeenCalledWith('next-page')
    })
  })

  it('shows next-page errors at the pagination boundary and retries from there', async () => {
    const user = userEvent.setup()
    let nextPageAttempts = 0
    let resolveNextPage: (() => void) | undefined
    const nextPagePending = new Promise<void>((resolve) => {
      resolveNextPage = resolve
    })
    const triggerIntersection = stubScrollRootIntersectionObserver()
    mockInstalledApps = [createInstalledApp()]
    mockInstalledAppsRequest.mockImplementation(
      async ({ query }: { query: { cursor?: string; name?: string } }) => {
        if (!query.cursor) {
          return {
            installed_apps: mockInstalledApps,
            has_more: true,
            next_cursor: 'next-page',
          }
        }

        nextPageAttempts += 1
        if (nextPageAttempts === 1) throw new Error('Failed to load the next page')

        await nextPagePending

        return {
          installed_apps: [
            createInstalledApp({
              id: 'installed-2',
              app: { ...createInstalledApp().app, name: 'Beta Tool' },
            }),
          ],
          has_more: false,
          next_cursor: null,
        }
      },
    )
    renderMainNav()
    const firstAppLink = await screen.findByRole('link', {
      name: 'common.mainNav.webApps.openApp:{"name":"Alpha App"}',
    })

    await triggerIntersection()

    const paginationError = await screen.findByRole('alert')
    expect(
      firstAppLink.compareDocumentPosition(paginationError) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })
    const webAppsRegion = screen.getByRole('region', { name: 'explore.sidebar.webApps' })
    retryButton.focus()
    expect(retryButton).toHaveFocus()

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(webAppsRegion).toHaveAttribute('aria-busy', 'true')
      expect(retryButton).toBeInTheDocument()
      expect(retryButton).toHaveFocus()
      expect(retryButton).toHaveAttribute('aria-disabled', 'true')
    })

    await user.keyboard('{Enter}')
    expect(nextPageAttempts).toBe(2)

    act(() => {
      resolveNextPage?.()
    })

    expect(await screen.findByText('Beta Tool')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('collapses and expands installed web apps from the section arrow', async () => {
    const user = userEvent.setup()
    mockInstalledApps = [createInstalledApp()]

    renderMainNav()

    const webAppsButton = await screen.findByRole('button', { name: 'explore.sidebar.webApps' })
    expect(webAppsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha App')).toBeInTheDocument()

    await user.click(webAppsButton)

    expect(webAppsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()

    await user.click(webAppsButton)

    expect(webAppsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha App')).toBeInTheDocument()
  })

  it('updates pin status and reuses the existing delete confirmation for installed web apps', async () => {
    const user = userEvent.setup()
    mockInstalledApps = [createInstalledApp()]
    mockUninstall.mockResolvedValue(undefined)
    mockUpdatePinStatus.mockResolvedValue(undefined)

    renderMainNav()

    await user.hover(await screen.findByText('Alpha App'))
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(await screen.findByText('explore.sidebar.action.pin'))

    await waitFor(() => {
      expect(mockUpdatePinStatus).toHaveBeenCalledWith({
        params: { installed_app_id: 'installed-1' },
        body: { is_pinned: true },
      })
    })

    await user.hover(screen.getByText('Alpha App'))
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(await screen.findByText('explore.sidebar.action.delete'))
    await user.click(await screen.findByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockUninstall).toHaveBeenCalledWith({
        params: { installed_app_id: 'installed-1' },
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('common.api.remove')
    })
  })
})
