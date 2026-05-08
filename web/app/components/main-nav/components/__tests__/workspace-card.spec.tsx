import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import WorkspaceCard from '../workspace-card'

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

describe('WorkspaceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue(appContextValue)
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      isEducationAccount: false,
      isFetchedPlan: true,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: vi.fn(),
      setShowAccountSettingModal: vi.fn(),
    } as unknown as ModalContextState)
    vi.mocked(useWorkspacesContext).mockReturnValue({
      workspaces: [
        { id: 'workspace-1', name: 'Solar Studio', plan: Plan.sandbox, status: 'normal', created_at: 0, current: true },
      ],
    })
  })

  it('hides cloud-only credits and upgrade actions outside cloud edition', () => {
    renderWithSystemFeatures(<WorkspaceCard />)

    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common\.mainNav\.workspace\.credits/ })).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  })
})
