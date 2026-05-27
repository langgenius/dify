import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { useRouter } from '@/next/navigation'
import { switchWorkspace } from '@/service/common'
import { LicenseStatus } from '@/types/feature'
import { WorkspaceCard } from '../workspace-card'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: false,
  }
})

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

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  switchWorkspace: vi.fn(),
}))

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

const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()

describe('WorkspaceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue(appContextValue)
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: true,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    })
    vi.mocked(useWorkspacesContext).mockReturnValue({
      workspaces: [
        { id: 'workspace-1', name: 'Solar Studio', plan: Plan.sandbox, status: 'normal', created_at: 0, current: true },
        { id: 'workspace-2', name: 'Evan Workspace', plan: Plan.team, status: 'normal', created_at: 0, current: false },
      ],
    })
  })

  it('hides cloud-only credits and upgrade actions outside cloud edition', () => {
    renderWithSystemFeatures(<WorkspaceCard />)

    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common\.mainNav\.workspace\.credits/ })).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  })

  it('renders a stable skeleton while the current workspace is loading', () => {
    vi.mocked(useAppContext).mockReturnValue({
      ...appContextValue,
      currentWorkspace: {
        ...appContextValue.currentWorkspace,
        id: '',
        name: '',
      },
      isLoadingCurrentWorkspace: true,
    })

    renderWithSystemFeatures(<WorkspaceCard />)

    expect(screen.getByTestId('workspace-card-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
  })

  it('shows the license status instead of a billing plan when billing is disabled', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: false,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: false,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)

    renderWithSystemFeatures(<WorkspaceCard />, {
      systemFeatures: {
        license: {
          status: LicenseStatus.ACTIVE,
          expired_at: null,
        },
      },
    })

    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.queryByText(Plan.sandbox)).not.toBeInTheDocument()
  })

  it('opens workspace actions and switcher in a dropdown menu', async () => {
    renderWithSystemFeatures(<WorkspaceCard />)

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.mainNav.workspace.settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.mainNav.workspace.inviteMembers' })).toBeInTheDocument()
    expect(screen.getByText('common.mainNav.workspace.switchWorkspace')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Evan Workspace' })).toBeInTheDocument()
  })

  it('opens account settings from workspace menu actions', async () => {
    renderWithSystemFeatures(<WorkspaceCard />)

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'common.mainNav.workspace.settings' }))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.BILLING })
  })

  it('switches workspace from the dropdown item', async () => {
    vi.mocked(switchWorkspace).mockReturnValue(new Promise(() => {}))
    renderWithSystemFeatures(<WorkspaceCard />)

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Evan Workspace' }))

    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith({ url: '/workspaces/switch', body: { tenant_id: 'workspace-2' } }))
  })

  it('hides workspace management actions for dataset operators', async () => {
    vi.mocked(useAppContext).mockReturnValue({
      ...appContextValue,
      isCurrentWorkspaceDatasetOperator: true,
      isCurrentWorkspaceManager: false,
    })

    renderWithSystemFeatures(<WorkspaceCard />)

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'common.mainNav.workspace.settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'common.mainNav.workspace.inviteMembers' })).not.toBeInTheDocument()
  })
})
