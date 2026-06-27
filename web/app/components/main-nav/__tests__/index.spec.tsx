import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { IWorkspace } from '@/models/common'
import type { InstalledApp } from '@/models/explore'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { createTestQueryClient, renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useStore as useAppStore } from '@/app/components/app/store'
import { Plan } from '@/app/components/billing/type'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '@/app/components/explore/learn-dify/storage'
import { useGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { STEP_BY_STEP_TOUR_STORAGE_KEY } from '@/app/components/step-by-step-tour/constants'
import { useAppContext, useSelector as useAppContextSelector } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import MainNav from '../index'
import { DETAIL_SIDEBAR_STORAGE_KEY } from '../storage'

const activeGradientMaskClassName = 'aria-[current=page]:main-nav-active-glass'
const activeStackingClassName = 'aria-[current=page]:z-1'

const { mockIsAgentV2Enabled, mockSwitchWorkspace, mockToastSuccess, hotkeyRegistrations } = vi.hoisted(() => ({
  mockSwitchWorkspace: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockIsAgentV2Enabled: vi.fn(() => true),
  hotkeyRegistrations: new Map<string, {
    handler: (event: { preventDefault: () => void }) => void
    options?: { ignoreInputs?: boolean }
  }>(),
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
  useSelector: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
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
      'common.stepByStepTour.skip': 'Skip',
      'common.stepByStepTour.minimize': 'Minimize tour',
      'common.stepByStepTour.restore': 'Open step-by-step tour',
      'common.stepByStepTour.learnMore': 'Learn more',
      'common.stepByStepTour.tasks.home.title': 'Try a Learn Dify lesson',
      'common.stepByStepTour.tasks.home.description': 'Open a hands-on lesson from Learn Dify to see Dify in action.',
      'common.stepByStepTour.tasks.home.primaryActionLabel': 'Show me',
      'common.stepByStepTour.tasks.studio.title': 'Manage your apps in Studio',
      'common.stepByStepTour.tasks.studio.description': 'All your apps live in Studio — edit, organize, and publish them here.',
      'common.stepByStepTour.tasks.studio.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.knowledge.title': 'Add your own data',
      'common.stepByStepTour.tasks.knowledge.description': 'Build a knowledge base so your apps answer from your documents.',
      'common.stepByStepTour.tasks.knowledge.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.integration.title': 'Explore integrations',
      'common.stepByStepTour.tasks.integration.description': 'Models, tools, data sources & more — explore what you can connect.',
      'common.stepByStepTour.tasks.integration.primaryActionLabel': 'Take a look',
    }),
  }
})

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const currentWorkspaceQueryKey = ['console', 'workspaces', 'current', 'post'] as const
  const workspacesQueryKey = ['console', 'workspaces', 'get'] as const
  const consoleQuery = new Proxy(actual.consoleQuery, {
    get(target, prop, receiver) {
      if (prop === 'workspaces') {
        return {
          current: {
            post: {
              key: () => currentWorkspaceQueryKey,
              queryKey: () => currentWorkspaceQueryKey,
              queryOptions: (options?: object) => ({
                queryKey: currentWorkspaceQueryKey,
                queryFn: () => new Promise(() => {}),
                ...options,
              }),
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

      return Reflect.get(target, prop, receiver)
    },
  })

  return {
    ...actual,
    consoleQuery,
  }
})

vi.mock('@/service/use-explore', () => ({
  useGetInstalledApps: vi.fn(),
  useUninstallApp: vi.fn(),
  useUpdateAppPinStatus: vi.fn(),
}))

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

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    useHotkey: (
      hotkey: string,
      handler: (event: { preventDefault: () => void }) => void,
      options?: { ignoreInputs?: boolean },
    ) => {
      hotkeyRegistrations.set(hotkey, { handler, options })
    },
  }
})

vi.mock('@/app/components/header/github-star', () => ({
  default: ({ className }: { className?: string }) => <span className={className}>1,234</span>,
}))

vi.mock('@/app/components/app-sidebar/app-detail-section', () => ({
  default: ({ expand }: { expand: boolean }) => <div data-testid="app-detail-section" data-expand={expand} />,
}))

vi.mock('@/app/components/app-sidebar/app-detail-top', () => ({
  default: ({ expand, onToggle }: { expand: boolean, onToggle: () => void }) => (
    <div data-testid="app-detail-top" data-expand={expand}>
      <button type="button" data-testid="app-detail-toggle" onClick={onToggle}>Toggle</button>
    </div>
  ),
}))

vi.mock('@/app/components/app-sidebar/dataset-detail-section', () => ({
  default: ({ expand }: { expand: boolean }) => <div data-testid="dataset-detail-section" data-expand={expand} />,
}))

vi.mock('@/app/components/app-sidebar/dataset-detail-top', () => ({
  default: ({ expand, onToggle }: { expand: boolean, onToggle: () => void }) => (
    <div data-testid="dataset-detail-top" data-expand={expand}>
      <button type="button" data-testid="dataset-detail-toggle" onClick={onToggle}>Toggle</button>
    </div>
  ),
}))

vi.mock('@/features/agent-v2/agent-detail/navigation', () => ({
  AgentDetailSection: ({ expand }: { expand: boolean }) => <div data-testid="agent-detail-section" data-expand={expand} />,
  AgentDetailTop: ({ expand, onToggle }: { expand: boolean, onToggle: () => void }) => (
    <div data-testid="agent-detail-top" data-expand={expand}>
      <button type="button" data-testid="agent-detail-toggle" onClick={onToggle}>Toggle</button>
    </div>
  ),
}))

vi.mock('@/features/deployments/detail/deployment-sidebar', () => ({
  DeploymentDetailSection: ({ expand }: { expand: boolean }) => <div data-testid="deployment-detail-section" data-expand={expand} />,
  DeploymentDetailTop: ({ expand, onToggle }: { expand: boolean, onToggle: () => void }) => (
    <div data-testid="deployment-detail-top" data-expand={expand}>
      <button type="button" data-testid="deployment-detail-toggle" onClick={onToggle}>Toggle</button>
    </div>
  ),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
    SUPPORT_EMAIL_ADDRESS: '',
    ZENDESK_WIDGET_KEY: '',
  }
})

const mockPush = vi.fn()
const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
const mockUninstall = vi.fn()
const mockUpdatePinStatus = vi.fn()
let mockPathname = '/apps'
let mockInstalledApps: InstalledApp[] = []
let mockInstalledAppsPending = false
let mockWorkspaces: IWorkspace[] = []

const ownerWorkspacePermissionKeys = [
  'workspace.member.manage',
  'workspace.role.manage',
  'app_library.access',
  'app.create_and_management',
  'dataset.create_and_management',
  'dataset.external.connect',
  'tool.manage',
  'mcp.manage',
]

const datasetOperatorWorkspacePermissionKeys = [
  'plugin.install',
  'dataset.create_and_management',
  'dataset.external.connect',
]

const createInstalledApp = (overrides: Partial<InstalledApp> = {}): InstalledApp => ({
  id: overrides.id ?? 'installed-1',
  uninstallable: overrides.uninstallable ?? false,
  is_pinned: overrides.is_pinned ?? false,
  app: {
    id: overrides.app?.id ?? 'app-1',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '🤖',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Alpha App',
    description: overrides.app?.description ?? '',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
})

const appContextValue: AppContextValue = {
  userProfile: {
    id: 'user-1',
    name: 'Evan Z',
    email: 'evan@example.com',
    avatar: '',
    avatar_url: '',
    is_password_set: true,
  },
  mutateUserProfile: vi.fn(),
  currentWorkspace: {
    id: 'workspace-1',
    name: 'Solar Studio',
    plan: Plan.sandbox,
    status: 'normal',
    created_at: 0,
    role: 'owner',
    providers: [],
    trial_credits: 10000,
    trial_credits_used: 2500,
    next_credit_reset_date: 0,
  },
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceDatasetOperator: false,
  mutateCurrentWorkspace: vi.fn(),
  langGeniusVersionInfo: {
    current_env: 'testing',
    current_version: '1.0.0',
    latest_version: '1.0.0',
    release_date: '',
    release_notes: '',
    version: '1.0.0',
    can_auto_update: false,
  },
  useSelector: vi.fn(),
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  isValidatingCurrentWorkspace: false,
  workspacePermissionKeys: ownerWorkspacePermissionKeys,
}

type MainNavSystemFeatures = Exclude<NonNullable<Parameters<typeof renderWithSystemFeatures>[1]>['systemFeatures'], null | undefined>

const defaultMainNavSystemFeatures: MainNavSystemFeatures = {
  branding: { enabled: false },
  enable_marketplace: true,
}

const renderMainNav = (
  systemFeatures: MainNavSystemFeatures = defaultMainNavSystemFeatures,
  options: { store?: ReturnType<typeof createStore>, extra?: ReactNode } = {},
) => {
  const queryClient = createTestQueryClient()
  const getMockAppContext = useAppContext as Mock
  const currentAppContext = getMockAppContext() as AppContextValue
  queryClient.setQueryData(consoleQuery.workspaces.current.post.queryKey(), currentAppContext.currentWorkspace)
  queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })
  const resolvedSystemFeatures = {
    ...defaultMainNavSystemFeatures,
    ...systemFeatures,
    branding: {
      ...defaultMainNavSystemFeatures.branding,
      ...systemFeatures.branding,
    },
  }
  return renderWithSystemFeatures(
    <JotaiProvider store={options.store}>
      <MainNav />
      {options.extra}
    </JotaiProvider>,
    { systemFeatures: resolvedSystemFeatures, queryClient },
  )
}

function GotoAnythingOpenProbe() {
  const open = useGotoAnythingOpen()
  return <div data-testid="goto-anything-open">{String(open)}</div>
}

describe('MainNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPathname = '/apps'
    mockInstalledApps = []
    mockInstalledAppsPending = false
    mockWorkspaces = [
      { id: 'workspace-1', name: 'Solar Studio', plan: Plan.team, status: 'normal', created_at: 0, current: true },
      { id: 'workspace-2', name: 'Evan Workspace', plan: Plan.sandbox, status: 'normal', created_at: 0, current: false },
    ]
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
    ;(useAppContext as Mock).mockReturnValue(appContextValue)
    ;(useAppContextSelector as Mock).mockImplementation((selector: (state: AppContextValue) => unknown) => selector((useAppContext as Mock)() as AppContextValue))
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: true,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)
    ;(useModalContext as Mock).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    ;(useGetInstalledApps as Mock).mockImplementation(() => ({
      isPending: mockInstalledAppsPending,
      data: { installed_apps: mockInstalledApps },
    }))
    ;(useUninstallApp as Mock).mockReturnValue({
      mutateAsync: mockUninstall,
      isPending: false,
    })
    ;(useUpdateAppPinStatus as Mock).mockReturnValue({
      mutateAsync: mockUpdatePinStatus,
    })
    mockSwitchWorkspace.mockReturnValue(new Promise(() => {}))
    hotkeyRegistrations.clear()
    useAppStore.getState().setAppDetail()
  })

  it('renders primary navigation with the planned routes', () => {
    renderMainNav()

    expect(screen.getAllByText(Plan.team)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'common.account.account' })).not.toHaveTextContent(Plan.team)
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toHaveAttribute('href', '/apps')
    expect(screen.getByRole('link', { name: /common.menus.roster/ })).toHaveAttribute('href', '/roster')
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute('href', '/datasets')
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toHaveAttribute('href', '/integrations/model-provider')
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toHaveAttribute('href', '/marketplace')
  })

  it('hides the roster entry when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)

    renderMainNav()

    expect(screen.queryByRole('link', { name: /common.menus.roster/ })).not.toBeInTheDocument()
  })

  it('hides the marketplace entry when marketplace is disabled', () => {
    renderMainNav({ enable_marketplace: false })

    expect(screen.queryByRole('link', { name: /common.mainNav.marketplace/ })).not.toBeInTheDocument()
  })

  it('renders deployments in primary navigation when app deploy is enabled', () => {
    renderMainNav({ branding: { enabled: false }, enable_app_deploy: true })

    const marketplaceLink = screen.getByRole('link', { name: /common.mainNav.marketplace/ })
    const deploymentsLink = screen.getByRole('link', { name: /common.menus.deployments/ })

    expect(deploymentsLink).toHaveAttribute('href', '/deployments')
    expect(marketplaceLink.compareDocumentPosition(deploymentsLink)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('hides deployments in primary navigation when app deploy is disabled', () => {
    renderMainNav({ branding: { enabled: false }, enable_app_deploy: false })

    expect(screen.queryByRole('link', { name: /common.menus.deployments/ })).not.toBeInTheDocument()
  })

  it('aligns the global navigation spacing with the main sidebar design', () => {
    mockInstalledApps = [createInstalledApp()]

    renderMainNav()

    const logoLink = screen.getByLabelText('Dify')
    expect(logoLink).not.toHaveClass('px-2')
    expect(logoLink.parentElement).toHaveClass('pt-3', 'pr-2', 'pb-2', 'pl-4')

    const homeLink = screen.getByRole('link', { name: /common.mainNav.home/ })
    expect(homeLink.closest('nav')).toHaveClass('isolate', 'flex', 'flex-col', 'gap-px', 'p-2')
    expect(homeLink).toHaveClass('h-8', 'w-full', 'rounded-[10px]', 'px-2', 'py-1.5')

    const webAppsButton = screen.getByRole('button', { name: 'explore.sidebar.webApps' })
    expect(webAppsButton.parentElement).toHaveClass('py-1', 'pr-2', 'pl-2')

    const helpButton = screen.getByRole('button', { name: 'common.mainNav.help.openMenu' })
    expect(helpButton.parentElement).toHaveClass('shrink-0', 'rounded-full', 'p-1')
  })

  it('keeps the global navigation account section expanded on home routes', () => {
    localStorage.setItem(DETAIL_SIDEBAR_STORAGE_KEY, 'collapse')
    mockPathname = '/'

    renderMainNav()

    const accountButton = screen.getByRole('button', { name: 'common.account.account' })
    expect(accountButton).toHaveTextContent('Evan Z')
    expect(accountButton).toHaveClass('max-w-[180px]', 'gap-3', 'py-1', 'pr-4', 'pl-1')
    expect(accountButton).not.toHaveClass('justify-center', 'p-1')
  })

  it('renders the desktop environment tag from the old header contract', () => {
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      langGeniusVersionInfo: {
        ...appContextValue.langGeniusVersionInfo,
        current_env: 'TESTING',
      },
    })

    renderMainNav()

    const environmentTag = screen.getByText('common.environment.testing')
    expect(environmentTag).toBeInTheDocument()
    expect(environmentTag.closest('.relative.z-30')).toHaveClass('mt-auto', 'shrink-0')
  })

  it('does not reserve environment tag space when the environment is not shown', () => {
    const { container } = renderMainNav()

    expect(screen.queryByText('common.environment.testing')).not.toBeInTheDocument()
    expect(screen.queryByText('common.environment.development')).not.toBeInTheDocument()
    expect(container.querySelector('.relative.z-30')).not.toBeInTheDocument()
  })

  it('hides the environment tag when app detail navigation is collapsed', () => {
    mockPathname = '/app/app-1/overview'
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      langGeniusVersionInfo: {
        ...appContextValue.langGeniusVersionInfo,
        current_env: 'TESTING',
      },
    })

    const { container } = renderMainNav()
    fireEvent.click(screen.getByTestId('app-detail-toggle'))

    expect(screen.queryByText('common.environment.testing')).not.toBeInTheDocument()
    expect(container.querySelector('.relative.z-30')).not.toBeInTheDocument()
  })

  it('shows the user education badge in the account popup without adding the workspace plan there', async () => {
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      isEducationAccount: true,
      isEducationWorkspace: false,
      isFetchedPlan: true,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.account.account' }))

    expect(await screen.findByText('EDU')).toBeInTheDocument()
    expect(screen.getByText('evan@example.com')).toBeInTheDocument()
    expect(screen.getAllByText(Plan.team)).toHaveLength(1)
  })

  it('keeps unrestricted main routes visible for dataset operators while hiding roster', () => {
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      currentWorkspace: {
        ...appContextValue.currentWorkspace,
        role: 'dataset_operator',
      },
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: datasetOperatorWorkspacePermissionKeys,
    })

    renderMainNav()

    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toHaveAttribute('href', '/apps')
    expect(screen.queryByRole('link', { name: /common.menus.roster/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute('href', '/datasets')
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toHaveAttribute('href', '/integrations/model-provider')
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toHaveAttribute('href', '/marketplace')
    expect(screen.queryByRole('link', { name: /common.menus.deployments/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
  })

  it('keeps unrestricted main routes visible without route permission keys', () => {
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      currentWorkspace: {
        ...appContextValue.currentWorkspace,
        role: 'normal',
      },
      isCurrentWorkspaceDatasetOperator: false,
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: ['app_library.access', 'tool.manage'],
    })

    renderMainNav({ branding: { enabled: false }, enable_app_deploy: true })

    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.roster/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.deployments/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toBeInTheDocument()
  })

  it('marks the matching primary route active', () => {
    mockPathname = '/datasets'

    renderMainNav()

    const datasetsLink = screen.getByRole('link', { name: /common.menus.datasets/ })
    expect(datasetsLink).toHaveClass(activeGradientMaskClassName)
    expect(datasetsLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).not.toHaveAttribute('aria-current')
  })

  it('keeps Studio active on snippets routes', () => {
    mockPathname = '/snippets'

    renderMainNav()

    const studioLink = screen.getByRole('link', { name: /common.menus.apps/ })
    expect(studioLink).toHaveClass(activeGradientMaskClassName)
    expect(studioLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).not.toHaveAttribute('aria-current')
  })

  it('hides the main menu on snippet detail routes while keeping account settings available', () => {
    mockPathname = '/snippets/snippet-1/orchestrate'

    renderMainNav()

    expect(screen.getByRole('complementary')).toHaveClass('w-16')
    expect(screen.queryByLabelText('Dify')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.apps/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.account.account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' })).toBeInTheDocument()
  })

  it('replaces global navigation with app detail navigation on app routes', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()

    expect(screen.getByTestId('app-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('app-detail-section')).toBeInTheDocument()
    expect(screen.getByTestId('app-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('app-detail-section')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByRole('complementary')).toHaveClass('w-[248px]')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByRole('complementary')).toHaveClass('bg-background-body')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.apps/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
  })

  it('keeps app detail store when rendering app detail navigation', () => {
    mockPathname = '/app/app-1/logs'
    useAppStore.getState().setAppDetail({ id: 'app-1' } as ReturnType<typeof useAppStore.getState>['appDetail'])

    renderMainNav()

    expect(useAppStore.getState().appDetail?.id).toBe('app-1')
  })

  it('clears app detail store after leaving app routes', async () => {
    mockPathname = '/apps'
    useAppStore.getState().setAppDetail({ id: 'app-1' } as ReturnType<typeof useAppStore.getState>['appDetail'])

    renderMainNav()

    await waitFor(() => {
      expect(useAppStore.getState().appDetail).toBeUndefined()
    })
  })

  it('collapses app detail navigation from the top-right toggle', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()
    fireEvent.click(screen.getByTestId('app-detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-16')
    expect(screen.getByRole('complementary')).not.toHaveClass('transition-none')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByTestId('app-detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('app-detail-section')).toHaveAttribute('data-expand', 'false')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('shows app detail navigation as a floating preview when hovering the collapsed top toggle', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()
    fireEvent.click(screen.getByTestId('app-detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('app-detail-top').parentElement!)

    expect(screen.getByRole('complementary')).toHaveClass('w-16', 'overflow-visible')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
    expect(screen.getAllByTestId('app-detail-top')).toHaveLength(1)
    expect(screen.getByTestId('app-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('app-detail-section')).toHaveAttribute('data-expand', 'true')
  })

  it('persists expanded app detail navigation without width animation when clicking the hovered toggle', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()
    fireEvent.click(screen.getByTestId('app-detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('app-detail-top').parentElement!)
    fireEvent.click(screen.getByTestId('app-detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-[248px]', 'transition-none')
    expect(screen.getByRole('complementary')).not.toHaveClass('overflow-visible')
    expect(screen.getByTestId('app-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('app-detail-section')).toHaveAttribute('data-expand', 'true')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('expand')
  })

  it('replaces global navigation with dataset detail navigation on dataset routes', () => {
    mockPathname = '/datasets/dataset-1/documents'

    renderMainNav()

    expect(screen.getByTestId('dataset-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('dataset-detail-section')).toBeInTheDocument()
    expect(screen.getByTestId('dataset-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('dataset-detail-section')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByRole('complementary')).toHaveClass('w-[248px]')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByRole('complementary')).toHaveClass('bg-background-body')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.datasets/ })).not.toBeInTheDocument()
  })

  it('collapses dataset detail navigation from the top-right toggle', () => {
    mockPathname = '/datasets/dataset-1/documents'

    renderMainNav()
    fireEvent.click(screen.getByTestId('dataset-detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-16')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByTestId('dataset-detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('dataset-detail-section')).toHaveAttribute('data-expand', 'false')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('shows dataset detail navigation as a floating preview when hovering the collapsed top toggle', () => {
    mockPathname = '/datasets/dataset-1/documents'

    renderMainNav()
    fireEvent.click(screen.getByTestId('dataset-detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('dataset-detail-top').parentElement!)

    expect(screen.getByRole('complementary')).toHaveClass('w-16', 'overflow-visible')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
    expect(screen.getAllByTestId('dataset-detail-top')).toHaveLength(1)
    expect(screen.getByTestId('dataset-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('dataset-detail-section')).toHaveAttribute('data-expand', 'true')
  })

  it('replaces global navigation with agent detail navigation on roster detail routes', () => {
    mockPathname = '/roster/agent/agent-1/configure'

    renderMainNav()

    expect(screen.getByTestId('agent-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('agent-detail-section')).toBeInTheDocument()
    expect(screen.getByTestId('agent-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('agent-detail-section')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByRole('complementary')).toHaveClass('w-[248px]')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByRole('complementary')).toHaveClass('bg-background-body')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.roster/ })).not.toBeInTheDocument()
  })

  it('keeps roster detail navigation hidden when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)
    mockPathname = '/roster/agent/agent-1/configure'

    renderMainNav()

    expect(screen.queryByTestId('agent-detail-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-detail-section')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.roster/ })).not.toBeInTheDocument()
  })

  it('replaces global navigation with deployment detail navigation on deployment routes', () => {
    mockPathname = '/deployments/app-instance-1/releases'

    renderMainNav({ branding: { enabled: false }, enable_app_deploy: true })

    expect(screen.getByTestId('deployment-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('deployment-detail-section')).toBeInTheDocument()
    expect(screen.getByTestId('deployment-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('deployment-detail-section')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByRole('complementary')).toHaveClass('w-[248px]')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByRole('complementary')).toHaveClass('bg-background-body')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.deployments/ })).not.toBeInTheDocument()
  })

  it('collapses agent detail navigation from the top-right toggle', () => {
    mockPathname = '/roster/agent/agent-1/configure'

    renderMainNav()
    fireEvent.click(screen.getByTestId('agent-detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-16')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByTestId('agent-detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('agent-detail-section')).toHaveAttribute('data-expand', 'false')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('collapses deployment detail navigation from the top-right toggle', () => {
    mockPathname = '/deployments/app-instance-1/releases'

    renderMainNav({ branding: { enabled: false }, enable_app_deploy: true })
    fireEvent.click(screen.getByTestId('deployment-detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-16')
    expect(screen.getByRole('complementary')).toHaveClass('p-1')
    expect(screen.getByTestId('deployment-detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('deployment-detail-section')).toHaveAttribute('data-expand', 'false')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it.each([
    '/deployments',
    '/deployments/create',
  ])('keeps global navigation on deployment collection route %s', (pathname) => {
    mockPathname = pathname

    renderMainNav({ branding: { enabled: false }, enable_app_deploy: true })

    expect(screen.queryByTestId('deployment-detail-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deployment-detail-section')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.deployments/ })).toHaveAttribute('href', '/deployments')
  })

  it('registers the detail navigation shortcut to run while inputs are focused', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()

    expect(hotkeyRegistrations.get('Mod+B')?.options).toEqual(
      expect.objectContaining({ ignoreInputs: false }),
    )
  })

  it('shows agent detail navigation as a floating preview when hovering the collapsed top toggle', () => {
    mockPathname = '/roster/agent/agent-1/configure'

    renderMainNav()
    fireEvent.click(screen.getByTestId('agent-detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('agent-detail-top').parentElement!)

    expect(screen.getByRole('complementary')).toHaveClass('w-16', 'overflow-visible')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
    expect(screen.getAllByTestId('agent-detail-top')).toHaveLength(1)
    expect(screen.getByTestId('agent-detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('agent-detail-section')).toHaveAttribute('data-expand', 'true')
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
    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute('href', '/datasets')
  })

  it('marks marketplace active on marketplace routes', () => {
    mockPathname = '/marketplace'

    renderMainNav()

    const marketplaceLink = screen.getByRole('link', { name: /common.mainNav.marketplace/ })
    expect(marketplaceLink).toHaveClass(activeGradientMaskClassName)
  })

  it('marks roster active on roster routes', () => {
    mockPathname = '/roster'

    renderMainNav()

    const rosterLink = screen.getByRole('link', { name: /common.menus.roster/ })
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

  it('keeps Home active on the legacy explore apps route only', () => {
    mockPathname = '/explore/apps'

    const { rerender } = renderMainNav()

    const homeLink = screen.getByRole('link', { name: /common.mainNav.home/ })
    expect(homeLink).toHaveAttribute('aria-current', 'page')

    mockPathname = '/installed/installed-1'
    rerender(<JotaiProvider><MainNav /></JotaiProvider>)

    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).not.toHaveAttribute('aria-current')
  })

  it('opens goto anything from the search button', () => {
    const store = createStore()

    renderMainNav(undefined, { store, extra: <GotoAnythingOpenProbe /> })
    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('true')
  })

  it('shows Learn Dify switch in help menu and restores it from localStorage', async () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderMainNav({ enable_learn_app: true })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    const learnDifyItem = await screen.findByRole('menuitemcheckbox', { name: 'common.mainNav.help.learnDify' })
    expect(learnDifyItem).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(learnDifyItem)

    await waitFor(() => {
      expect(localStorage.getItem(LEARN_DIFY_HIDDEN_STORAGE_KEY)).toBe('false')
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows Step-by-step Tour switch in help menu and stores the current workspace disable override', async () => {
    renderMainNav({ enable_learn_app: true })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    const stepByStepTourItem = await screen.findByRole('menuitemcheckbox', { name: 'common.mainNav.help.stepByStepTour' })
    expect(stepByStepTourItem).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(stepByStepTourItem)

    await waitFor(() => {
      expect(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)).toContain('"manuallyDisabledWorkspaceIds":["workspace-1"]')
    })
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('restores the expanded Step-by-step Tour after toggling it off and on again', async () => {
    renderMainNav({ enable_learn_app: true })

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    const stepByStepTourItem = await screen.findByRole('menuitemcheckbox', { name: 'common.mainNav.help.stepByStepTour' })

    fireEvent.click(stepByStepTourItem)

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })

    fireEvent.click(stepByStepTourItem)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeVisible()
    })
    expect(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)).toContain('"manuallyDisabledWorkspaceIds":[]')
  })

  it('keeps Step-by-step Tour mini mounted when detail navigation is collapsed during walkthrough', async () => {
    mockPathname = '/app/app-1/overview'
    useAppStore.getState().setAppDetail({
      id: 'app-1',
    } as NonNullable<ReturnType<typeof useAppStore.getState>['appDetail']>)
    localStorage.setItem(DETAIL_SIDEBAR_STORAGE_KEY, 'collapse')
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))

    renderMainNav({ enable_learn_app: true })

    expect(await screen.findByRole('button', { name: 'Open step-by-step tour' })).toBeInTheDocument()
  })

  it('hides Learn Dify switch in help menu when learn app is disabled', async () => {
    renderMainNav({ enable_learn_app: false })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))

    await screen.findByText('common.mainNav.help.docs')
    expect(screen.queryByRole('menuitemcheckbox', { name: 'common.mainNav.help.learnDify' })).not.toBeInTheDocument()
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
    const nodes = await Promise.all(labels.map(label => screen.findByText(label)))

    nodes.slice(1).forEach((node, index) => {
      expect(nodes[index]!.compareDocumentPosition(node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })
  })

  it('closes the help menu from the support upgrade action', async () => {
    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    expect(await screen.findByText('common.userProfile.contactUs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }))

    await waitFor(() => {
      expect(screen.queryByText('common.userProfile.forum')).not.toBeInTheDocument()
    })
    expect(mockSetShowPricingModal).toHaveBeenCalled()
  })

  it('hides the help menu when branding is enabled', () => {
    renderMainNav({ branding: { enabled: true } })

    expect(screen.queryByRole('button', { name: 'common.mainNav.help.openMenu' })).not.toBeInTheDocument()
  })

  it('opens workspace settings, members, plan, and workspace switching actions', async () => {
    renderMainNav()

    expect(screen.getByRole('link', { name: /common\.mainNav\.workspace\.credits|7,500 credits/ })).toHaveAttribute('href', '/integrations/model-provider')
    expect(mockSetShowAccountSettingModal).not.toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.PROVIDER })

    fireEvent.click(screen.getByText('billing.upgradeBtn.plain'))
    expect(mockSetShowPricingModal).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByText('common.mainNav.workspace.settings'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.BILLING })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByText('common.mainNav.workspace.inviteMembers'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.MEMBERS })

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByText('Evan Workspace'))
    await waitFor(() => {
      expect(mockSwitchWorkspace).toHaveBeenCalledWith({ body: { tenant_id: 'workspace-2' } })
    })
  })

  it('shows the upgrade shortcut for sandbox workspaces', () => {
    mockWorkspaces = [
      { id: 'workspace-1', name: 'Solar Studio', plan: Plan.sandbox, status: 'normal', created_at: 0, current: true },
    ]

    renderMainNav()

    expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.plain')).not.toBeInTheDocument()
  })

  it('shows the view plan shortcut for paid workspaces', () => {
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: true,
      plan: { type: Plan.team },
    } as ProviderContextState)

    renderMainNav()

    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('billing.upgradeBtn.plain'))
    expect(mockSetShowPricingModal).toHaveBeenCalled()
    expect(mockSetShowAccountSettingModal).not.toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.BILLING })
  })

  it('limits invite members by member management permission', async () => {
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      currentWorkspace: {
        ...appContextValue.currentWorkspace,
        role: 'normal',
      },
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: ownerWorkspacePermissionKeys.filter(key => key !== 'workspace.member.manage'),
    })

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByText('common.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('common.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('keeps workspace settings visible and hides invite members without member management permission', () => {
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      currentWorkspace: {
        ...appContextValue.currentWorkspace,
        role: 'dataset_operator',
      },
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      workspacePermissionKeys: datasetOperatorWorkspacePermissionKeys,
    })

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(screen.getByText('common.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('common.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('filters installed web apps and renders installed app navigation link', () => {
    mockInstalledApps = [
      createInstalledApp({ id: 'installed-1', app: { ...createInstalledApp().app, name: 'Alpha App' } }),
      createInstalledApp({ id: 'installed-2', app: { ...createInstalledApp().app, name: 'Beta Tool' } }),
    ]

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.search' }))
    fireEvent.change(screen.getByPlaceholderText('common.mainNav.webApps.searchPlaceholder'), {
      target: { value: 'beta' },
    })

    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Beta Tool' })).toHaveAttribute('href', '/installed/installed-2')
  })

  it('renders web app skeleton rows while installed apps are loading', () => {
    mockInstalledAppsPending = true

    renderMainNav()

    expect(screen.getByRole('region', { name: 'explore.sidebar.webApps' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.search' })).not.toBeInTheDocument()
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()
  })

  it('hides the installed web apps section when no web apps are available', () => {
    renderMainNav()

    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
    expect(screen.queryByText('explore.sidebar.noApps.title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.search' })).not.toBeInTheDocument()
  })

  it('separates pinned and unpinned installed web apps', () => {
    mockInstalledApps = [
      createInstalledApp({ id: 'installed-1', is_pinned: true, app: { ...createInstalledApp().app, name: 'Pinned App' } }),
      createInstalledApp({ id: 'installed-2', is_pinned: false, app: { ...createInstalledApp().app, name: 'Unpinned App' } }),
    ]

    renderMainNav()

    expect(screen.getByText('Pinned App')).toBeInTheDocument()
    expect(screen.getByText('Unpinned App')).toBeInTheDocument()
    expect(screen.getByTestId('divider')).toBeInTheDocument()
  })

  it('keeps long installed web app names truncated in the main nav item', () => {
    const longName = 'A very long installed web app name that should stay on one line and truncate'
    mockInstalledApps = [
      createInstalledApp({ id: 'installed-1', app: { ...createInstalledApp().app, name: longName } }),
    ]

    renderMainNav()

    expect(screen.getByText(longName)).toHaveClass('truncate')
  })

  it('virtualizes large installed web app lists', async () => {
    const offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320)
    const offsetWidthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    mockInstalledApps = Array.from({ length: 100 }, (_, index) => (
      createInstalledApp({
        id: `installed-${index}`,
        app: {
          ...createInstalledApp().app,
          id: `app-${index}`,
          name: `Web App ${index}`,
        },
      })
    ))

    try {
      renderMainNav()

      expect(await screen.findByText('Web App 0')).toBeInTheDocument()
      expect(screen.queryByText('Web App 99')).not.toBeInTheDocument()
    }
    finally {
      offsetHeightSpy.mockRestore()
      offsetWidthSpy.mockRestore()
    }
  })

  it('collapses and expands installed web apps from the section arrow', () => {
    mockInstalledApps = [createInstalledApp()]

    renderMainNav()

    const webAppsButton = screen.getByRole('button', { name: 'explore.sidebar.webApps' })
    expect(webAppsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha App')).toBeInTheDocument()

    fireEvent.click(webAppsButton)

    expect(webAppsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()

    fireEvent.click(webAppsButton)

    expect(webAppsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha App')).toBeInTheDocument()
  })

  it('updates pin status and reuses the existing delete confirmation for installed web apps', async () => {
    mockInstalledApps = [createInstalledApp()]
    mockUninstall.mockResolvedValue(undefined)
    mockUpdatePinStatus.mockResolvedValue(undefined)

    renderMainNav()

    fireEvent.mouseEnter(screen.getByText('Alpha App'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
    fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

    await waitFor(() => {
      expect(mockUpdatePinStatus).toHaveBeenCalledWith({ appId: 'installed-1', isPinned: true })
    })

    fireEvent.mouseEnter(screen.getByText('Alpha App'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
    fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))
    fireEvent.click(await screen.findByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockUninstall).toHaveBeenCalledWith('installed-1')
      expect(mockToastSuccess).toHaveBeenCalledWith('common.api.remove')
    })
  })
})
