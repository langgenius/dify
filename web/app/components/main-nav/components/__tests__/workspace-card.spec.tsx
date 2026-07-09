import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { ICurrentWorkspace, IWorkspace } from '@/models/common'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { createTestQueryClient, renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { LicenseStatus } from '@/features/system-features/constants'
import { consoleQuery } from '@/service/client'
import { WorkspaceCard } from '../workspace-card'

const { mockSwitchWorkspace, mockIsCloudEdition, mockCurrentWorkspaceQueryKey, mockWorkspacesQueryKey } = vi.hoisted(() => ({
  mockSwitchWorkspace: vi.fn(),
  mockIsCloudEdition: { value: false },
  mockCurrentWorkspaceQueryKey: ['console', 'workspaces', 'current', 'post'] as const,
  mockWorkspacesQueryKey: ['console', 'workspaces', 'get'] as const,
}))
const mockAppContextState = vi.hoisted(() => ({
  current: {
    workspacePermissionKeys: [] as string[],
  },
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

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const consoleQuery = new Proxy(actual.consoleQuery, {
    get(target, prop, receiver) {
      if (prop === 'workspaces') {
        return {
          current: {
            post: {
              key: () => mockCurrentWorkspaceQueryKey,
              queryKey: () => mockCurrentWorkspaceQueryKey,
              queryOptions: (options?: object) => ({
                queryKey: mockCurrentWorkspaceQueryKey,
                queryFn: () => new Promise(() => {}),
                ...options,
              }),
            },
          },
          get: {
            queryKey: () => mockWorkspacesQueryKey,
            queryOptions: () => ({
              queryKey: mockWorkspacesQueryKey,
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
let mockCurrentWorkspace: ICurrentWorkspace | undefined = currentWorkspaceValue
let mockWorkspaces: IWorkspace[] = []

const mockCurrentWorkspaceQuery = (data: ICurrentWorkspace | undefined = currentWorkspaceValue, isPending = false) => {
  mockCurrentWorkspace = isPending ? undefined : data
}

type RenderWorkspaceCardOptions = Parameters<typeof renderWithSystemFeatures>[1] & {
  seedWorkspaces?: boolean
}

const renderWorkspaceCard = (options?: RenderWorkspaceCardOptions) => {
  const { seedWorkspaces = true, ...renderOptions } = options ?? {}
  const queryClient = createTestQueryClient()
  if (mockCurrentWorkspace)
    queryClient.setQueryData(consoleQuery.workspaces.current.post.queryKey(), mockCurrentWorkspace)
  if (seedWorkspaces)
    queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })

  return renderWithSystemFeatures(<WorkspaceCard />, {
    ...renderOptions,
    queryClient,
  })
}

const mockWorkspacePermissionKeys = (workspacePermissionKeys: string[]) => {
  mockAppContextState.current = {
    workspacePermissionKeys,
  }
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
    mockWorkspacePermissionKeys(['workspace.member.manage'])
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
  })

  it('hides cloud-only credits and upgrade actions outside cloud edition', () => {
    renderWorkspaceCard()

    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /common\.mainNav\.workspace\.credits/ })).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  })

  it('links workspace credits to model provider settings in cloud edition', () => {
    mockIsCloudEdition.value = true

    renderWorkspaceCard()

    expect(screen.getByRole('link', { name: /common\.mainNav\.workspace\.credits/ })).toHaveAttribute('href', '/integrations/model-provider')
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

  it('uses the original paid plan badge for paid workspaces', () => {
    mockIsCloudEdition.value = true
    mockWorkspaces = [
      { id: 'workspace-1', name: 'Solar Studio', plan: Plan.team, status: 'normal', created_at: 0, current: true },
    ]
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: true,
      plan: { type: Plan.team },
    } as ProviderContextState)

    renderWorkspaceCard()

    expect(screen.getByText(Plan.team)).toBeInTheDocument()
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
          expired_at: '',
        },
      },
    })

    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.queryByText(Plan.sandbox)).not.toBeInTheDocument()
  })

  it('opens workspace actions and switcher in a popover panel', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveClass('w-[280px]')
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.inviteMembers' })).toBeInTheDocument()
    expect(within(panel).getByText('common.userProfile.workspace')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.sort.openMenu' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'common.operation.search' })).toBeInTheDocument()
    const workspaceItem = within(panel).getByRole('button', { name: 'Evan Workspace' })
    expect(workspaceItem).toBeInTheDocument()
    expect(workspaceItem.parentElement).toHaveClass('max-h-[240px]', 'overflow-y-auto')
  })

  it('filters workspace switcher options from the search action', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.operation.search' }))

    expect(screen.getByText('common.userProfile.workspace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.mainNav.workspace.sort.openMenu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.search' })).toHaveClass('bg-state-base-hover')

    fireEvent.change(screen.getByPlaceholderText('common.mainNav.workspace.searchPlaceholder'), {
      target: { value: 'evan' },
    })

    const panel = screen.getByRole('dialog', { name: 'Solar Studio' })
    expect(within(panel).getByRole('button', { name: 'Evan Workspace' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Solar Studio' })).not.toBeInTheDocument()
  })

  it('sorts workspaces by last opened and can sort by created time', async () => {
    mockWorkspaces = [
      { id: 'workspace-1', name: 'Solar Studio', plan: Plan.sandbox, status: 'normal', created_at: 1, last_opened_at: 20, current: true },
      { id: 'workspace-2', name: 'Evan Workspace', plan: Plan.team, status: 'normal', created_at: 3, last_opened_at: null, current: false },
      { id: 'workspace-3', name: 'Atlas Workspace', plan: Plan.team, status: 'normal', created_at: 2, last_opened_at: 30, current: false },
    ]
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    const defaultWorkspaceOptions = within(panel).getAllByRole('button').map(item => item.getAttribute('title')).filter(Boolean)

    expect(defaultWorkspaceOptions).toEqual(['Atlas Workspace', 'Solar Studio', 'Evan Workspace'])

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.sort.openMenu' }))

    expect(await screen.findByRole('menuitemradio', { name: 'common.mainNav.workspace.sort.lastOpened' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'common.mainNav.workspace.sort.createdTime' }))

    const createdTimeWorkspaceOptions = within(panel).getAllByRole('button').map(item => item.getAttribute('title')).filter(Boolean)

    expect(createdTimeWorkspaceOptions).toEqual(['Evan Workspace', 'Atlas Workspace', 'Solar Studio'])
  })

  it('opens account settings from workspace menu actions', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.mainNav.workspace.settings' }))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.BILLING })
  })

  it('opens members settings from workspace menu when billing is disabled', async () => {
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: false,
      isEducationAccount: false,
      isEducationWorkspace: false,
      isFetchedPlan: false,
      plan: { type: Plan.sandbox },
    } as ProviderContextState)

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.mainNav.workspace.settings' }))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.MEMBERS })
    expect(mockSetShowAccountSettingModal).not.toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.BILLING })
  })

  it('switches workspace from the workspace switcher item', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Evan Workspace' }))

    await waitFor(() => expect(mockSwitchWorkspace).toHaveBeenCalledWith({ body: { tenant_id: 'workspace-2' } }))
  })

  it('keeps workspace settings visible for dataset operators without member management permission', async () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      role: 'dataset_operator',
    })
    mockWorkspacePermissionKeys([])

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(panel).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'common.mainNav.workspace.inviteMembers' })).not.toBeInTheDocument()
  })

  it('shows invite members when member management permission is available', async () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      role: 'normal',
    })
    mockWorkspacePermissionKeys(['workspace.member.manage'])

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.inviteMembers' })).toBeInTheDocument()
  })

  it('hides invite members when member management permission is missing', async () => {
    mockWorkspacePermissionKeys([])

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: 'common.mainNav.workspace.openMenu' }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'common.mainNav.workspace.inviteMembers' })).not.toBeInTheDocument()
  })
})
