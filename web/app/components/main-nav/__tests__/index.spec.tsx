import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { GetVersionResponse } from '@dify/contracts/api/console/version/types.gen'
import type {
  GetWorkspacesCurrentSummaryResponse,
  TenantListItemResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import Cookies from 'js-cookie'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '@/app/components/detail-sidebar/cookie'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '@/app/components/explore/learn-dify/storage'
import { GotoAnything } from '@/app/components/goto-anything'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import {
  stepByStepTourSessionAtom,
  stepByStepTourSkipRecoveryVisibleAtom,
} from '@/app/components/step-by-step-tour/state'
import { STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY } from '@/app/components/step-by-step-tour/storage'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithoutPricing,
} from '@/test/console/query-data'
import { createStepByStepTourService } from '@/test/fixtures/onboarding'
import { MainNav } from '../index'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

const mockTrackEvent = vi.hoisted(() => vi.fn())

const { mockInstalledAppsRequest, mockIsAgentV2Enabled, mockSwitchWorkspace, mockUpdatePinStatus } =
  vi.hoisted(() => ({
    mockInstalledAppsRequest: vi.fn(),
    mockIsAgentV2Enabled: vi.fn(() => true),
    mockSwitchWorkspace: vi.fn(),
    mockUpdatePinStatus: vi.fn(),
  }))
const mockStepByStepTour = createStepByStepTourService()

type MainNavConsoleState = ConsoleStateFixture & {
  profileMeta: UserProfileWithMeta['meta']
  versionData: GetVersionResponse
}

const mockConsoleState = vi.hoisted(() => ({
  current: undefined as MainNavConsoleState | undefined,
}))
let skillEnabled = true
let educationEnabled = false

vi.mock('@tanstack/react-virtual')

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mockTrackEvent,
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
    useRouter: vi.fn(),
    useParams: () => ({}),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'onboarding.stepByStepTour.title': 'Get to know Dify',
      'onboarding.stepByStepTour.duration': 'A quick tour — about 5 minutes',
      'onboarding.stepByStepTour.skip': 'Skip tour',
      'onboarding.stepByStepTour.minimize': 'Minimize tour',
      'onboarding.stepByStepTour.restore': 'Open step-by-step tour',
      'onboarding.stepByStepTour.learnMore': 'Learn more',
      'onboarding.stepByStepTour.skipRecovery.label': 'Step-by-step Tour recovery tip',
      'onboarding.stepByStepTour.skipRecovery.message':
        'Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.',
      'onboarding.stepByStepTour.skipRecovery.dismiss': 'Got it',
      'onboarding.stepByStepTour.tasks.home.title': 'Try a Learn Dify lesson',
      'onboarding.stepByStepTour.tasks.home.description':
        'Open a hands-on lesson from Learn Dify to see Dify in action.',
      'onboarding.stepByStepTour.tasks.home.primaryActionLabel': 'Show me',
      'onboarding.stepByStepTour.tasks.studio.title': 'Manage your apps in Studio',
      'onboarding.stepByStepTour.tasks.studio.description':
        'All your apps live in Studio — edit, organize, and publish them here.',
      'onboarding.stepByStepTour.tasks.studio.primaryActionLabel': 'Take a look',
      'onboarding.stepByStepTour.tasks.knowledge.title': 'Add your own data',
      'onboarding.stepByStepTour.tasks.knowledge.description':
        'Build a knowledge base so your apps answer from your documents.',
      'onboarding.stepByStepTour.tasks.knowledge.primaryActionLabel': 'Take a look',
      'onboarding.stepByStepTour.tasks.integration.title': 'Explore integrations',
      'onboarding.stepByStepTour.tasks.integration.description':
        'Models, tools, data sources & more — explore what you can connect.',
      'onboarding.stepByStepTour.tasks.integration.primaryActionLabel': 'Take a look',
    }),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.switch.post': mockSwitchWorkspace,
      'onboarding.stepByStepTour.state.get': async () => mockStepByStepTour.state,
      'onboarding.stepByStepTour.state.patch': (input) => mockStepByStepTour.patchState(input),
      'installedApps.get': mockInstalledAppsRequest,
      'installedApps.byInstalledAppId.patch': mockUpdatePinStatus,
    }),
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
  'agent.acl.preview',
  'skill.view',
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
  is_pinned: overrides.is_pinned ?? false,
  app: {
    id: overrides.app?.id ?? 'app-1',
    mode: overrides.app?.mode ?? 'chat',
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
const accountMenuAccessibleName = `${mainNavUserProfile.name} accountSettings.account.account`

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
const workspaceMenuAccessibleName = /Solar Studio.*navigation\.mainNav\.workspace\.openMenu/

type MainNavSystemFeatures = Exclude<
  NonNullable<Parameters<typeof renderWithoutPricing>[1]>['systemFeatures'],
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
    educationStatus?: NonNullable<Parameters<typeof renderWithoutPricing>[1]>['educationStatus']
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
  queryClient.setQueryData(
    consoleQuery.onboarding.stepByStepTour.state.get.queryKey(),
    mockStepByStepTour.state,
  )
  queryClient.setQueryData(['github-star'], { repo: { stars: 1234 } })
  const store = options.store ?? createStore()
  store.set(queryClientAtom, queryClient)
  store.set(stepByStepTourSessionAtom, {})
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
  return render(
    <JotaiProvider store={store}>
      <MainNav />
      {options.extra}
    </JotaiProvider>,
    {
      systemFeatures: resolvedSystemFeatures,
      features: {
        billing: { subscription: { plan: 'sandbox' } },
        enable_skill: skillEnabled,
        education: { enabled: educationEnabled },
      },
      educationStatus: options.educationStatus,
      workspacePermissionKeys: currentConsoleState.workspacePermissionKeys,
      queryClient,
    },
  )
}

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('MainNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInstalledAppsRequest.mockReset()
    mockUpdatePinStatus.mockReset()
    mockSwitchWorkspace.mockReset()
    localStorage.clear()
    Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
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
    skillEnabled = true
    educationEnabled = false

    mockInstalledAppsRequest.mockImplementation(
      async ({ query }: { query: { cursor?: string; name?: string } }) => {
        if (mockInstalledAppsPending) return new Promise(() => {})
        if (query.cursor) {
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
    mockUpdatePinStatus.mockResolvedValue({ result: 'success', message: 'updated' })
    mockSwitchWorkspace.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    act(() => toast.dismiss())
  })

  it('renders primary navigation with the planned routes', () => {
    renderMainNav()

    expect(screen.getAllByText('team')).toHaveLength(1)
    expect(screen.getByRole('button', { name: accountMenuAccessibleName })).not.toHaveTextContent(
      'team',
    )
    const homeLink = screen.getByRole('link', { name: /navigation.mainNav.home/ })
    expect(homeLink).toHaveAttribute('href', '/')
    const studioLink = screen.getByRole('link', { name: /navigation.menus.apps/ })
    expect(studioLink).toHaveAttribute('href', '/apps')
    const agentsLink = screen.getByRole('link', { name: /Agents/ })
    expect(agentsLink).toHaveAttribute('href', '/agents')
    expect(screen.getByRole('link', { name: /Agents navigation.menus.status/ })).toBeInTheDocument()
    const skillsLink = screen.getByRole('link', { name: /navigation.mainNav.skills/ })
    expect(skillsLink).toHaveAttribute('href', '/skills')
    const knowledgeLink = screen.getByRole('link', { name: /navigation.menus.datasets/ })
    expect(knowledgeLink).toHaveAttribute('href', '/datasets')
    const integrationsLink = screen.getByRole('link', { name: /navigation.mainNav.integrations/ })
    expect(integrationsLink).toHaveAttribute('href', '/integrations/model-provider')
    const marketplaceLink = screen.getByRole('link', { name: /navigation.mainNav.marketplace/ })
    expect(marketplaceLink).toHaveAttribute('href', '/marketplace')
    expect(
      within(screen.getByRole('navigation', { name: 'common.navigation.primary' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/',
      '/apps',
      '/agents',
      '/datasets',
      '/skills',
      '/integrations/model-provider',
      '/marketplace',
    ])
  })

  it('hides the roster entry when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)

    renderMainNav()

    expect(screen.queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.mainNav.skills/ })).toHaveAttribute(
      'href',
      '/skills',
    )
  })

  it('shows the roster entry when the user lacks agent.acl.preview', () => {
    mockConsoleState.current = {
      ...consoleState,
      workspacePermissionKeys: ownerWorkspacePermissionKeys.filter(
        (key) => key !== 'agent.acl.preview',
      ),
    }

    renderMainNav()

    expect(screen.getByRole('link', { name: /Agents/ })).toBeInTheDocument()
  })

  it('hides the marketplace entry when marketplace is disabled', () => {
    renderMainNav({ enable_marketplace: false })

    expect(
      screen.queryByRole('link', { name: /navigation.mainNav.marketplace/ }),
    ).not.toBeInTheDocument()
  })

  it('hides the skills entry when skill is disabled', () => {
    skillEnabled = false

    renderMainNav()

    expect(
      screen.queryByRole('link', { name: /navigation.mainNav.skills/ }),
    ).not.toBeInTheDocument()
  })

  it('hides the skills entry when the user lacks skill.view', () => {
    mockConsoleState.current = {
      ...consoleState,
      workspacePermissionKeys: ownerWorkspacePermissionKeys.filter((key) => key !== 'skill.view'),
    }

    renderMainNav()

    expect(
      screen.queryByRole('link', { name: /navigation.mainNav.skills/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps the global navigation account section expanded on home routes', () => {
    Cookies.set(DETAIL_SIDEBAR_COOKIE_NAME, 'collapse')
    mockPathname = '/'

    renderMainNav()

    const accountButton = screen.getByRole('button', { name: accountMenuAccessibleName })
    expect(accountButton).toHaveTextContent('Evan Z')
  })

  it('shows the user education badge in the account popup without adding the workspace plan there', async () => {
    const user = userEvent.setup()
    educationEnabled = true

    renderMainNav(defaultMainNavSystemFeatures, {
      educationStatus: { is_student: true },
    })

    await user.click(screen.getByRole('button', { name: accountMenuAccessibleName }))

    expect(await screen.findByText('EDU')).toBeInTheDocument()
    expect(screen.getByText('evan@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('team')).toHaveLength(1)
  })

  it('keeps unrestricted main routes and roster visible for dataset operators', () => {
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        role: 'dataset_operator',
      },
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: datasetOperatorWorkspacePermissionKeys,
    }

    renderMainNav()

    expect(screen.getByRole('link', { name: /navigation.mainNav.home/ })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: /navigation.menus.apps/ })).toHaveAttribute(
      'href',
      '/apps',
    )
    expect(screen.getByRole('link', { name: /Agents/ })).toHaveAttribute('href', '/agents')
    expect(
      screen.queryByRole('link', { name: /navigation.mainNav.skills/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.menus.datasets/ })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.getByRole('link', { name: /navigation.mainNav.integrations/ })).toHaveAttribute(
      'href',
      '/integrations/model-provider',
    )
    expect(screen.getByRole('link', { name: /navigation.mainNav.marketplace/ })).toHaveAttribute(
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
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: ['app_library.access', 'tool.manage'],
    }

    renderMainNav({ branding: { enabled: false } })

    expect(screen.getByRole('link', { name: /navigation.mainNav.home/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.menus.apps/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Agents/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.menus.datasets/ })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /navigation.mainNav.integrations/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.mainNav.marketplace/ })).toBeInTheDocument()
  })

  it('marks the matching primary route active', () => {
    mockPathname = '/datasets'

    renderMainNav()

    const datasetsLink = screen.getByRole('link', { name: /navigation.menus.datasets/ })
    expect(datasetsLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /navigation.mainNav.home/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps Studio active on snippets routes', () => {
    mockPathname = '/snippets'

    renderMainNav()

    const studioLink = screen.getByRole('link', { name: /navigation.menus.apps/ })
    expect(studioLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /navigation.mainNav.home/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps roster detail navigation hidden when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)
    mockPathname = '/agents/agent-1/configure'

    renderMainNav()

    expect(screen.queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
  })

  it('keeps MainNav on primary navigation when it is mounted on a detail route', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()

    expect(screen.getByRole('button', { name: workspaceMenuAccessibleName })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.menus.apps/ })).toHaveAttribute(
      'href',
      '/apps',
    )
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

    expect(screen.getByRole('button', { name: workspaceMenuAccessibleName })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigation.menus.datasets/ })).toHaveAttribute(
      'href',
      '/datasets',
    )
  })

  it.each(['/marketplace', '/plugins', '/templates', '/templates/marketing'])(
    'marks marketplace active on route %s',
    (pathname) => {
      mockPathname = pathname

      renderMainNav()

      const marketplaceLink = screen.getByRole('link', { name: /navigation.mainNav.marketplace/ })
      expect(marketplaceLink).toHaveAttribute('aria-current', 'page')
    },
  )

  it('marks roster active on roster routes', () => {
    mockPathname = '/agents'

    renderMainNav()

    const rosterLink = screen.getByRole('link', { name: /Agents/ })
    expect(rosterLink).toHaveAttribute('aria-current', 'page')
  })

  it('marks Home active at the root route', () => {
    mockPathname = '/'

    renderMainNav()

    const homeLink = screen.getByRole('link', { name: /navigation.mainNav.home/ })

    expect(homeLink).toHaveAttribute('aria-current', 'page')
  })

  it('opens goto anything from the search button', async () => {
    const user = userEvent.setup()
    renderMainNav(undefined, {
      extra: <GotoAnything />,
    })

    await user.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(
      await screen.findByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
    ).toBeInTheDocument()
  })

  it('shows Learn Dify switch in help menu and restores it from localStorage', async () => {
    const user = userEvent.setup()
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderMainNav({ enable_learn_app: true })

    const helpTrigger = screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' })
    expect(helpTrigger).not.toHaveAttribute('data-popup-open')

    await user.click(helpTrigger)

    expect(helpTrigger).toHaveAttribute('data-popup-open', '')
    const learnDifyItem = await screen.findByRole('menuitemcheckbox', {
      name: 'navigation.mainNav.help.learnDify',
    })
    expect(learnDifyItem).toHaveAttribute('aria-checked', 'false')

    await user.click(learnDifyItem)

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

    const helpTrigger = screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' })
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

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))
    const stepByStepTourItem = await screen.findByRole('menuitemcheckbox', {
      name: 'navigation.mainNav.help.stepByStepTour',
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

  it('closes the help menu and opens Step-by-step Tour when enabling it', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY, 'collapsed')
    mockStepByStepTour.setState({
      first_workspace_id: null,
      manually_enabled_workspace_ids: [],
      manually_disabled_workspace_ids: [],
    })

    renderMainNav({ enable_learn_app: true })

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))
    const stepByStepTourItem = await screen.findByRole('menuitemcheckbox', {
      name: 'navigation.mainNav.help.stepByStepTour',
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

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))
    expect(
      await screen.findByRole('menuitemcheckbox', {
        name: 'navigation.mainNav.help.stepByStepTour',
      }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('hides Step-by-step Tour switch when the feature is disabled', async () => {
    const user = userEvent.setup()
    renderMainNav({
      enable_learn_app: true,
      enable_step_by_step_tour: false,
    })

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))

    await screen.findByText('navigation.mainNav.help.docs')
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'navigation.mainNav.help.stepByStepTour' }),
    ).not.toBeInTheDocument()
  })

  it('hides Learn Dify switch in help menu when learn app is disabled', async () => {
    const user = userEvent.setup()
    renderMainNav({ enable_learn_app: false })

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))

    await screen.findByText('navigation.mainNav.help.docs')
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'navigation.mainNav.help.learnDify' }),
    ).not.toBeInTheDocument()
  })

  it('opens Creator Center from the help menu above GitHub', async () => {
    const user = userEvent.setup()
    renderMainNav()

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))

    const creatorCenter = await screen.findByRole('menuitem', {
      name: 'navigation.mainNav.help.creatorCenter',
    })
    const github = screen.getByRole('menuitem', { name: /common\.userProfile\.github/ })

    expect(creatorCenter).toHaveAttribute('href', 'https://creators.dify.ai/')
    expect(creatorCenter).toHaveAttribute('target', '_blank')
    expect(creatorCenter).toHaveAttribute('rel', 'noopener noreferrer')
    expect(creatorCenter.compareDocumentPosition(github)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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

    const helpButton = screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' })
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

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))
    await user.click(await screen.findByRole('menuitem', { name: /common\.userProfile\.about/ }))

    expect(await screen.findByRole('link', { name: 'Open Source License' })).toHaveAttribute(
      'href',
      'https://github.com/langgenius/dify/blob/main/LICENSE',
    )
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument()
  })

  it('closes the help menu from the support upgrade action', async () => {
    const user = userEvent.setup()
    renderMainNav()

    await user.click(screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }))
    const contactUsItem = await screen.findByRole('menuitem', {
      name: 'common.userProfile.contactUs billing.upgradeBtn.encourageShort',
    })
    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()

    await user.click(contactUsItem)

    await waitFor(() => {
      expect(screen.queryByText('common.userProfile.discord')).not.toBeInTheDocument()
    })
    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })

  it('hides the help menu when branding is enabled', () => {
    renderMainNav({ branding: { enabled: true } }, { skipRecoveryVisible: true })

    expect(
      screen.queryByRole('button', { name: 'navigation.mainNav.help.openMenu' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'Step-by-step Tour recovery tip' }),
    ).not.toBeInTheDocument()
  })

  it('opens workspace settings, members, plan, and workspace switching actions', async () => {
    const user = userEvent.setup()
    renderMainNav()

    expect(
      screen.getByRole('link', { name: /navigation\.mainNav\.workspace\.credits|7,500 credits/ }),
    ).toHaveAttribute('href', '/integrations/model-provider')
    expect(
      onPricingUrlUpdate.mock.calls.some(
        ([event]) => event.searchParams.get('settings') === 'provider',
      ),
    ).toBe(false)

    await user.click(screen.getByText('billing.upgradeBtn.plain'))
    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    await user.click(await screen.findByText('navigation.mainNav.workspace.settings'))
    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe(
        ACCOUNT_SETTING_TAB.BILLING,
      ),
    )

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    await user.click(await screen.findByText('navigation.mainNav.workspace.inviteMembers'))
    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe(
        ACCOUNT_SETTING_TAB.MEMBERS,
      ),
    )

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    await user.click(await screen.findByText('Evan Workspace'))
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

  it('shows the view plan shortcut for paid workspaces', async () => {
    const user = userEvent.setup()
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        plan: 'professional',
      },
    }

    renderMainNav()

    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    await user.click(screen.getByText('billing.upgradeBtn.plain'))
    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
    expect(
      onPricingUrlUpdate.mock.calls.some(
        ([event]) => event.searchParams.get('settings') === ACCOUNT_SETTING_TAB.BILLING,
      ),
    ).toBe(false)
  })

  it('limits invite members by member management permission', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    expect(await screen.findByText('navigation.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('navigation.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('keeps workspace settings visible and hides invite members without member management permission', async () => {
    const user = userEvent.setup()
    mockConsoleState.current = {
      ...consoleState,
      currentWorkspace: {
        ...consoleState.currentWorkspace,
        role: 'dataset_operator',
      },
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: datasetOperatorWorkspacePermissionKeys,
    }

    renderMainNav()

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    expect(screen.getByText('navigation.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('navigation.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
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

    const scrollViewport = await screen.findByRole('navigation', {
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

    const searchInput = screen.getByRole('searchbox', {
      name: 'navigation.mainNav.webApps.searchPlaceholder',
    })
    const webAppsButton = screen.getByRole('button', { name: 'explore.sidebar.webApps' })
    const listPanel = document.getElementById(webAppsButton.getAttribute('aria-controls')!)
    const searchPanel = document.getElementById(searchButton.getAttribute('aria-controls')!)
    expect(listPanel).toContainElement(scrollViewport)
    expect(searchPanel).toContainElement(searchInput)
    expect(listPanel).not.toContainElement(searchInput)
    await user.type(searchInput, 'beta')

    await waitFor(() => {
      expect(scrollViewport.scrollTop).toBe(0)
      expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()
      expect(screen.getByText('Beta Tool')).toBeInTheDocument()
    })
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Beta Tool' })).toHaveAttribute(
      'href',
      '/installed/installed-2',
    )

    await user.click(webAppsButton)
    expect(webAppsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Beta Tool' })).not.toBeInTheDocument()
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByPlaceholderText('navigation.mainNav.webApps.searchPlaceholder'),
    ).not.toBeInTheDocument()

    await user.click(webAppsButton)
    expect(webAppsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Beta Tool' })).toBeInTheDocument()
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByPlaceholderText('navigation.mainNav.webApps.searchPlaceholder')).toHaveValue(
      'beta',
    )
    expect(webAppsButton).toHaveFocus()
    await user.click(searchButton)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(searchButton).toHaveFocus()
  })

  it('announces no installed web app results only after the search settles', async () => {
    const user = userEvent.setup()
    let resolveSearch: (() => void) | undefined
    const searchPending = new Promise<void>((resolve) => {
      resolveSearch = resolve
    })
    mockInstalledApps = [createInstalledApp()]
    mockInstalledAppsRequest.mockImplementation(async ({ query }: { query: { name?: string } }) => {
      if (!query.name) {
        return {
          installed_apps: mockInstalledApps,
          has_more: false,
          next_cursor: null,
        }
      }

      await searchPending
      return {
        installed_apps: [],
        has_more: false,
        next_cursor: null,
      }
    })

    renderMainNav()

    const webAppsRegion = await screen.findByRole('navigation', {
      name: 'explore.sidebar.webApps',
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.search' }))
    const resultStatus = within(webAppsRegion).getByRole('status')
    expect(resultStatus).toBeEmptyDOMElement()

    await user.type(
      screen.getByPlaceholderText('navigation.mainNav.webApps.searchPlaceholder'),
      'z',
    )

    await waitFor(() => {
      expect(webAppsRegion).toHaveAttribute('aria-busy', 'true')
    })
    expect(resultStatus).toBeEmptyDOMElement()

    act(() => {
      resolveSearch?.()
    })

    await waitFor(() => {
      expect(webAppsRegion).toHaveAttribute('aria-busy', 'false')
      expect(resultStatus).toHaveTextContent('navigation.mainNav.webApps.noResults')
    })
    expect(within(webAppsRegion).getByRole('status')).toBe(resultStatus)
  })

  it('hides the installed web apps section while installed apps are loading', () => {
    mockInstalledAppsPending = true

    renderMainNav()

    expect(
      screen.queryByRole('navigation', { name: 'explore.sidebar.webApps' }),
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
    await waitFor(() => expect(mockInstalledAppsRequest).toHaveResolved())

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'explore.sidebar.webApps' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: 'explore.sidebar.webApps' }),
      ).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: 'common.operation.search' }),
    ).not.toBeInTheDocument()
  })

  it('keeps pinned and unpinned installed web apps in one accessible list', async () => {
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

    const rows = within(
      screen.getByRole('navigation', { name: 'explore.sidebar.webApps' }),
    ).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('aria-posinset', '1')
    expect(rows[1]).toHaveAttribute('aria-posinset', '2')
    for (const row of rows) expect(row).toHaveAttribute('aria-setsize', '2')
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
      name: 'Alpha App',
    })

    await triggerIntersection()

    const paginationError = await screen.findByRole('alert')
    expect(
      firstAppLink.compareDocumentPosition(paginationError) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })
    const webAppsRegion = screen.getByRole('navigation', { name: 'explore.sidebar.webApps' })
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

  it('updates pin status for installed web apps', async () => {
    const user = userEvent.setup()
    mockInstalledApps = [createInstalledApp()]
    mockUpdatePinStatus.mockResolvedValue(undefined)

    renderMainNav()

    await user.hover(await screen.findByText('Alpha App'))
    await user.click(
      screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*Alpha App/ }),
    )
    await user.click(await screen.findByText('explore.sidebar.action.pin'))

    await waitFor(() => {
      expect(mockUpdatePinStatus).toHaveBeenCalledWith({
        params: { installed_app_id: 'installed-1' },
        body: { is_pinned: true },
      })
    })
  })

  describe('Main nav collapse/expand toggle', () => {
    beforeEach(() => {
      localStorage.removeItem('main-nav-collapse-or-expand')
    })

    it('renders expanded by default with a collapse toggle button', () => {
      renderMainNav()

      const nav = screen.getByTestId('main-nav')
      expect(nav).toHaveAttribute('data-mode', 'expand')
      expect(nav).toHaveClass('w-62')
      expect(screen.getByTestId('main-nav-toggle')).toBeInTheDocument()
      expect(screen.getByTestId('main-nav-toggle')).toHaveAttribute(
        'aria-label',
        expect.stringMatching(/layout\.sidebar\.collapseSidebar|Collapse sidebar/),
      )
    })

    it('switches to collapsed mode and persists the choice when the toggle is clicked', async () => {
      const user = userEvent.setup()
      renderMainNav()

      expect(screen.getByTestId('main-nav')).toHaveAttribute('data-mode', 'expand')

      await user.click(screen.getByTestId('main-nav-toggle'))

      const nav = screen.getByTestId('main-nav')
      expect(nav).toHaveAttribute('data-mode', 'collapse')
      expect(nav).toHaveClass('w-16')
      expect(localStorage.getItem('main-nav-collapse-or-expand')).toBe('collapse')
      expect(screen.getByTestId('main-nav-toggle')).toHaveAttribute(
        'aria-label',
        expect.stringMatching(/layout\.sidebar\.expandSidebar|Expand sidebar/),
      )
    })

    it('hides secondary sidebar content (workspace card, web apps section, env tag) when collapsed', async () => {
      const user = userEvent.setup()
      renderMainNav()

      expect(screen.getByText('Solar Studio')).toBeInTheDocument()

      await user.click(screen.getByTestId('main-nav-toggle'))

      // Workspace card name should no longer be visible when collapsed.
      expect(screen.queryByText('Solar Studio')).not.toBeInTheDocument()
    })

    it('restores the collapsed mode from localStorage on subsequent renders', () => {
      localStorage.setItem('main-nav-collapse-or-expand', 'collapse')

      renderMainNav()

      const nav = screen.getByTestId('main-nav')
      expect(nav).toHaveAttribute('data-mode', 'collapse')
      expect(nav).toHaveClass('w-16')
    })
  })
})
