import type { Mock } from 'vitest'
import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { InstalledApp } from '@/models/explore'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { usePathname, useRouter } from '@/next/navigation'
import { switchWorkspace } from '@/service/common'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import MainNav from '../index'

const activeEdgeClassName = 'before:pointer-events-none'

const { mockToastSuccess } = vi.hoisted(() => ({
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

vi.mock('@/context/workspace-context', () => ({
  useWorkspacesContext: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
    useRouter: vi.fn(),
  }
})

vi.mock('@/service/common', () => ({
  switchWorkspace: vi.fn(),
}))

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

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

const mockPush = vi.fn()
const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
const mockUninstall = vi.fn()
const mockUpdatePinStatus = vi.fn()
let mockPathname = '/apps'
let mockInstalledApps: InstalledApp[] = []

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

const renderMainNav = () => renderWithSystemFeatures(<MainNav />, {
  systemFeatures: { branding: { enabled: false } },
})

describe('MainNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/apps'
    mockInstalledApps = []

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
      isFetchedPlan: true,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)
    ;(useModalContext as Mock).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    ;(useWorkspacesContext as Mock).mockReturnValue({
      workspaces: [
        { id: 'workspace-1', name: 'Solar Studio', plan: Plan.team, status: 'normal', created_at: 0, current: true },
        { id: 'workspace-2', name: 'Evan Workspace', plan: Plan.sandbox, status: 'normal', created_at: 0, current: false },
      ],
    })
    ;(useGetInstalledApps as Mock).mockImplementation(() => ({
      isPending: false,
      data: { installed_apps: mockInstalledApps },
    }))
    ;(useUninstallApp as Mock).mockReturnValue({
      mutateAsync: mockUninstall,
      isPending: false,
    })
    ;(useUpdateAppPinStatus as Mock).mockReturnValue({
      mutateAsync: mockUpdatePinStatus,
    })
    ;(switchWorkspace as Mock).mockReturnValue(new Promise(() => {}))
  })

  it('renders primary navigation with the planned routes', () => {
    renderMainNav()

    expect(screen.getAllByText(Plan.team)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'common.account.account' })).not.toHaveTextContent(Plan.team)
    expect(screen.getByRole('link', { name: /common.mainNav.home/ })).toHaveAttribute('href', '/explore/apps')
    expect(screen.getByRole('link', { name: /common.menus.apps/ })).toHaveAttribute('href', '/apps')
    expect(screen.getByRole('link', { name: /common.menus.datasets/ })).toHaveAttribute('href', '/datasets')
    expect(screen.getByRole('link', { name: /common.mainNav.integrations/ })).toHaveAttribute('href', '/tools')
    expect(screen.getByRole('link', { name: /common.mainNav.marketplace/ })).toHaveAttribute('href', '/plugins')
  })

  it('marks the matching primary route active', () => {
    mockPathname = '/datasets'

    renderMainNav()

    const datasetsLink = screen.getByRole('link', { name: /common.menus.datasets/ })
    expect(datasetsLink.className).toContain('bg-[linear-gradient(98.077deg')
    expect(datasetsLink).toHaveClass(activeEdgeClassName)
  })

  it('applies the Figma glass active state to the Home route', () => {
    mockPathname = '/explore/apps'

    renderMainNav()

    const homeLink = screen.getByRole('link', { name: /common.mainNav.home/ })

    expect(homeLink).toHaveClass(
      'border-transparent',
      'backdrop-blur-[5px]',
      'text-saas-dify-blue-inverted',
      activeEdgeClassName,
      'after:border-[rgba(255,255,255,0.98)]',
    )
    expect(homeLink.className).toContain('bg-[linear-gradient(98.077deg')
  })

  it('dispatches the goto anything open event from the search button', () => {
    const handleOpen = vi.fn()
    window.addEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)

    renderMainNav()
    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(handleOpen).toHaveBeenCalledTimes(1)
    window.removeEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
  })

  it('opens workspace settings, members, provider credits, upgrade, and workspace switching actions', async () => {
    renderMainNav()

    fireEvent.click(screen.getByRole('button', { name: /common\.mainNav\.workspace\.credits|7,500 credits/ }))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.PROVIDER })

    fireEvent.click(screen.getByText('billing.upgradeBtn.encourageShort'))
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
      expect(switchWorkspace).toHaveBeenCalledWith({ url: '/workspaces/switch', body: { tenant_id: 'workspace-2' } })
    })
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
    expect(mockPush).toHaveBeenCalledWith('/explore/installed/installed-2')
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
    fireEvent.click(screen.getByTestId('item-operation-trigger'))
    fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

    await waitFor(() => {
      expect(mockUpdatePinStatus).toHaveBeenCalledWith({ appId: 'installed-1', isPinned: true })
    })

    fireEvent.mouseEnter(screen.getByTitle('Alpha App'))
    fireEvent.click(screen.getByTestId('item-operation-trigger'))
    fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))
    fireEvent.click(await screen.findByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockUninstall).toHaveBeenCalledWith('installed-1')
      expect(mockToastSuccess).toHaveBeenCalledWith('common.api.remove')
    })
  })
})
