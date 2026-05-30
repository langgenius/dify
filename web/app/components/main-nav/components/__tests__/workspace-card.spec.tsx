import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { ICurrentWorkspace, IWorkspace } from '@/models/common'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createTestQueryClient, renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useCurrentWorkspace } from '@/service/use-common'
import { LicenseStatus } from '@/types/feature'
import { WorkspaceCard } from '../workspace-card'

const { mockSwitchWorkspace, mockIsCloudEdition } = vi.hoisted(() => ({
  mockSwitchWorkspace: vi.fn(),
  mockIsCloudEdition: { value: false },
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get IS_CLOUD_EDITION() {
      return mockIsCloudEdition.value
    },
  }
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
}))

vi.mock('@/service/use-common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-common')>()
  return {
    ...actual,
    useCurrentWorkspace: vi.fn(),
  }
})

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const workspacesQueryKey = ['console', 'workspaces', 'get'] as const
  const consoleQuery = new Proxy(actual.consoleQuery, {
    get(target, prop, receiver) {
      if (prop === 'workspaces') {
        return {
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

const currentWorkspaceValue: ICurrentWorkspace = {
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
}

const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
let mockWorkspaces: IWorkspace[] = []

const mockCurrentWorkspaceQuery = (data: ICurrentWorkspace | undefined = currentWorkspaceValue, isPending = false) => {
  vi.mocked(useCurrentWorkspace).mockReturnValue({
    data,
    isPending,
  } as ReturnType<typeof useCurrentWorkspace>)
}

type RenderWorkspaceCardOptions = Parameters<typeof renderWithSystemFeatures>[1] & {
  seedWorkspaces?: boolean
}

const renderWorkspaceCard = (options?: RenderWorkspaceCardOptions) => {
  const { seedWorkspaces = true, ...renderOptions } = options ?? {}
  const queryClient = createTestQueryClient()
  if (seedWorkspaces)
    queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })

  return renderWithSystemFeatures(<WorkspaceCard />, {
    ...renderOptions,
    queryClient,
  })
}

describe('WorkspaceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCloudEdition.value = false
    mockWorkspaces = [
      { id: 'workspace-1', name: 'Solar Studio', plan: Plan.sandbox, status: 'normal', created_at: 0, current: true },
      { id: 'workspace-2', name: 'Evan Workspace', plan: Plan.team, status: 'normal', created_at: 0, current: false },
    ]
    mockSwitchWorkspace.mockReturnValue(new Promise(() => {}))
    mockCurrentWorkspaceQuery()
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
  })

  it('hides cloud-only credits and upgrade actions outside cloud edition', () => {
    renderWorkspaceCard()

    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common\.mainNav\.workspace\.credits/ })).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  })

  it('renders a stable skeleton while the current workspace is loading', () => {
    mockCurrentWorkspaceQuery(undefined, true)

    renderWorkspaceCard()

    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByText('Evan Workspace')).not.toBeInTheDocument()
  })

  it('renders a skeleton while the workspaces query has no data', () => {
    renderWorkspaceCard({ seedWorkspaces: false })

    expect(screen.queryByRole('button', { name: 'common.mainNav.workspace.openMenu' })).not.toBeInTheDocument()
    expect(screen.queryByText('Solar Studio')).not.toBeInTheDocument()
  })

  it('uses the workspaces query current item for billing plan UI', () => {
    mockIsCloudEdition.value = true
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      plan: Plan.team,
    })
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: true,
      plan: { type: Plan.team },
    } as ProviderContextState)

    renderWorkspaceCard()

    expect(screen.getByText(Plan.sandbox)).toBeInTheDocument()
    expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
    expect(screen.queryByText(Plan.team)).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.plain')).not.toBeInTheDocument()
  })

  it('shows the license status instead of a billing plan when billing is disabled', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: false,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: false,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)

    renderWorkspaceCard({
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
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.mainNav.workspace.settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.mainNav.workspace.inviteMembers' })).toBeInTheDocument()
    expect(screen.getByText('common.mainNav.workspace.switchWorkspace')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Evan Workspace' })).toBeInTheDocument()
  })

  it('opens account settings from workspace menu actions', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'common.mainNav.workspace.settings' }))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.BILLING })
  })

  it('switches workspace from the dropdown item', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Evan Workspace' }))

    await waitFor(() => expect(mockSwitchWorkspace).toHaveBeenCalledWith({ body: { tenant_id: 'workspace-2' } }))
  })

  it('hides workspace management actions for dataset operators', async () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      role: 'dataset_operator',
    })

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'common.mainNav.workspace.settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'common.mainNav.workspace.inviteMembers' })).not.toBeInTheDocument()
  })
})
