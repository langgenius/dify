import type { Mock } from 'vitest'
import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { IWorkspace } from '@/models/common'
import type { InstalledApp } from '@/models/explore'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { createTestQueryClient, renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '@/app/components/explore/learn-dify/atoms'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import MainNav from '../index'

const activeEdgeClassName = 'before:pointer-events-none'

const { mockSwitchWorkspace, mockToastSuccess } = vi.hoisted(() => ({
  mockSwitchWorkspace: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
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

vi.mock('@/app/components/header/github-star', () => ({
  default: ({ className }: { className?: string }) => <span className={className}>1,234</span>,
}))

vi.mock('@/app/components/app-sidebar/app-detail-section', () => ({
  default: () => <div data-testid="app-detail-section" />,
}))

vi.mock('@/app/components/app-sidebar/app-detail-top', () => ({
  default: () => <div data-testid="app-detail-top" />,
}))

vi.mock('@/app/components/app-sidebar/dataset-detail-section', () => ({
  default: () => <div data-testid="dataset-detail-section" />,
}))

vi.mock('@/app/components/app-sidebar/dataset-detail-top', () => ({
  default: () => <div data-testid="dataset-detail-top" />,
}))

vi.mock('@/features/agent-v2/agent-detail/navigation', () => ({
  AgentDetailSection: () => <div data-testid="agent-detail-section" />,
  AgentDetailTop: () => <div data-testid="agent-detail-top" />,
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
  isValidatingCurrentWorkspace: false,
}

const renderMainNav = (
  systemFeatures = { branding: { enabled: false } },
) => {
  const queryClient = createTestQueryClient()
  const currentAppContext = (useAppContext as Mock)() as AppContextValue
  queryClient.setQueryData(consoleQuery.workspaces.current.post.queryKey(), currentAppContext.currentWorkspace)
  queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })
  return renderWithSystemFeatures(<JotaiProvider><MainNav /></JotaiProvider>, { systemFeatures, queryClient })
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

  it('hides app and tools entries for dataset operators', () => {
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
    })

    renderMainNav()

    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.apps/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.roster/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute('href', '/datasets')
    expect(screen.queryByRole('link', { name: /common.mainNav.integrations/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toHaveAttribute('href', '/marketplace')
    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
  })

  it('hides datasets for members without editor or dataset-operator access', () => {
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
    })

    renderMainNav()

    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.menus.roster/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.datasets/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toBeInTheDocument()
  })

  it('marks the matching primary route active', () => {
    mockPathname = '/datasets'

    renderMainNav()

    const datasetsLink = screen.getByRole('link', { name: /common.menus.datasets/ })
    expect(datasetsLink.className).toContain('bg-[linear-gradient(98.077deg')
    expect(datasetsLink).toHaveClass(activeEdgeClassName)
    expect(datasetsLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).not.toHaveAttribute('aria-current')
  })

  it('replaces global navigation with app detail navigation on app routes', () => {
    mockPathname = '/app/app-1/overview'

    renderMainNav()

    expect(screen.getByTestId('app-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('app-detail-section')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveClass('bg-components-panel-bg-blur')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.apps/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'explore.sidebar.webApps' })).not.toBeInTheDocument()
  })

  it('replaces global navigation with dataset detail navigation on dataset routes', () => {
    mockPathname = '/datasets/dataset-1/documents'

    renderMainNav()

    expect(screen.getByTestId('dataset-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('dataset-detail-section')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveClass('bg-components-panel-bg-blur')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.mainNav.home/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.datasets/ })).not.toBeInTheDocument()
  })

  it('replaces global navigation with agent detail navigation on roster detail routes', () => {
    mockPathname = '/roster/agent-1/configure'

    renderMainNav()

    expect(screen.getByTestId('agent-detail-top')).toBeInTheDocument()
    expect(screen.getByTestId('agent-detail-section')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveClass('bg-components-panel-bg-blur')
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common.menus.roster/ })).not.toBeInTheDocument()
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
    expect(marketplaceLink).toHaveClass(activeEdgeClassName)
  })

  it('marks roster active on roster routes', () => {
    mockPathname = '/roster'

    renderMainNav()

    const rosterLink = screen.getByRole('link', { name: /common.menus.roster/ })
    expect(rosterLink).toHaveClass(activeEdgeClassName)
    expect(rosterLink).toHaveAttribute('aria-current', 'page')
  })

  it('applies the Figma glass active state to the Home route', () => {
    mockPathname = '/'

    renderMainNav()

    const homeLink = screen.getByRole('link', { name: /common.mainNav.home/ })

    expect(homeLink).toHaveClass(
      'backdrop-blur-[5px]',
      'text-saas-dify-blue-inverted',
      activeEdgeClassName,
      'after:border-[rgba(255,255,255,0.98)]',
    )
    expect(homeLink.className).toContain('bg-[linear-gradient(98.077deg')
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

  it('dispatches the goto anything open event from the search button', () => {
    const handleOpen = vi.fn()
    window.addEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)

    renderMainNav()
    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(handleOpen).toHaveBeenCalledTimes(1)
    window.removeEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
  })

  it('shows Learn Dify switch in help menu and restores it from localStorage', async () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.help.openMenu' }))
    expect(await screen.findByText('common.mainNav.help.learnDify')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'common.mainNav.help.learnDify' }))

    await waitFor(() => {
      expect(localStorage.getItem(LEARN_DIFY_HIDDEN_STORAGE_KEY)).toBe('false')
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('hides the help menu when branding is enabled', () => {
    renderMainNav({ branding: { enabled: true } })

    expect(screen.queryByRole('button', { name: 'common.mainNav.help.openMenu' })).not.toBeInTheDocument()
  })

  it('opens workspace settings, members, provider credits, plan, and workspace switching actions', async () => {
    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: /common\.mainNav\.workspace\.credits|7,500 credits/ }))
    expect(mockPush).toHaveBeenCalledWith('/integrations/model-provider')
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

  it('limits workspace settings and invite actions by role', async () => {
    ;(useAppContext as Mock).mockReturnValue({
      ...appContextValue,
      currentWorkspace: {
        ...appContextValue.currentWorkspace,
        role: 'normal',
      },
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
    })

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByText('common.mainNav.workspace.settings')).toBeInTheDocument()
    expect(screen.queryByText('common.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('hides workspace settings actions for dataset operators', () => {
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
    })

    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(screen.queryByText('common.mainNav.workspace.settings')).not.toBeInTheDocument()
    expect(screen.queryByText('common.mainNav.workspace.inviteMembers')).not.toBeInTheDocument()
  })

  it('filters installed web apps and navigates to an installed app', () => {
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
    fireEvent.click(screen.getByText('Beta Tool'))
    expect(mockPush).toHaveBeenCalledWith('/installed/installed-2')
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
    expect(screen.getByTitle(longName)).toBeInTheDocument()
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

    fireEvent.mouseEnter(screen.getByTitle('Alpha App'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
    fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

    await waitFor(() => {
      expect(mockUpdatePinStatus).toHaveBeenCalledWith({ appId: 'installed-1', isPinned: true })
    })

    fireEvent.mouseEnter(screen.getByTitle('Alpha App'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
    fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))
    fireEvent.click(await screen.findByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockUninstall).toHaveBeenCalledWith('installed-1')
      expect(mockToastSuccess).toHaveBeenCalledWith('common.api.remove')
    })
  })
})
