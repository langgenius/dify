import type {
  GetWorkspacesCurrentSummaryResponse,
  TenantListItemResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { zLicenseStatus } from '@dify/contracts/api/console/system-features/zod.gen'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedSystemFeaturesLicense,
} from '@/test/console/query-data'
import { WorkspaceCard } from '../workspace-card'

const {
  mockFetchWorkspaces,
  mockSwitchWorkspace,
  mockCurrentWorkspaceQueryKey,
  mockWorkspacesQueryKey,
} = vi.hoisted(() => ({
  mockFetchWorkspaces: vi.fn(),
  mockSwitchWorkspace: vi.fn(),
  mockCurrentWorkspaceQueryKey: ['console', 'workspaces', 'current', 'summary', 'get'] as const,
  mockWorkspacesQueryKey: ['console', 'workspaces', 'get'] as const,
}))
const mockConsoleState = vi.hoisted(() => ({
  current: {
    workspacePermissionKeys: [] as string[],
  },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
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
            summary: {
              get: {
                key: () => mockCurrentWorkspaceQueryKey,
                queryKey: () => mockCurrentWorkspaceQueryKey,
                queryOptions: (options?: object) => ({
                  queryKey: mockCurrentWorkspaceQueryKey,
                  queryFn: () => new Promise(() => {}),
                  ...options,
                }),
              },
            },
          },
          get: {
            queryKey: () => mockWorkspacesQueryKey,
            queryOptions: (options?: object) => ({
              queryKey: mockWorkspacesQueryKey,
              queryFn: mockFetchWorkspaces,
              ...options,
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

const currentWorkspaceValue: GetWorkspacesCurrentSummaryResponse = {
  id: 'workspace-1',
  name: 'Solar Studio',
  plan: 'sandbox',
  role: 'owner',
  credits: 7500,
}
const workspaceMenuAccessibleName = new RegExp(
  `${currentWorkspaceValue.name}.*common\\.mainNav\\.workspace\\.openMenu`,
)

const mockSetShowPricingModal = vi.fn()
const mockSetSettingsDestination = vi.fn()
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})
let mockCurrentWorkspace: GetWorkspacesCurrentSummaryResponse | undefined = currentWorkspaceValue
let mockWorkspaces: TenantListItemResponse[] = []

const mockCurrentWorkspaceQuery = (
  data: GetWorkspacesCurrentSummaryResponse | undefined = currentWorkspaceValue,
  isPending = false,
) => {
  mockCurrentWorkspace = isPending ? undefined : data
}

type RenderWorkspaceCardOptions = Parameters<typeof renderWithConsoleQuery>[1] & {
  seedWorkspaces?: boolean
  systemFeaturesLicense?: Parameters<typeof seedSystemFeaturesLicense>[1]
}

const renderWorkspaceCard = (options?: RenderWorkspaceCardOptions) => {
  const { seedWorkspaces = true, systemFeaturesLicense, ...renderOptions } = options ?? {}
  const queryClient = createConsoleQueryClient()
  if (mockCurrentWorkspace)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.summary.get.queryKey(),
      mockCurrentWorkspace,
    )
  if (seedWorkspaces)
    queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })
  if (systemFeaturesLicense) seedSystemFeaturesLicense(queryClient, systemFeaturesLicense)

  return renderWithConsoleQuery(<WorkspaceCard />, {
    ...renderOptions,
    queryClient,
    currentWorkspace: mockCurrentWorkspace ? undefined : null,
  })
}

const mockWorkspacePermissionKeys = (workspacePermissionKeys: string[]) => {
  mockConsoleState.current = {
    workspacePermissionKeys,
  }
}

describe('WorkspaceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaces = [
      {
        id: 'workspace-1',
        name: 'Solar Studio',
        plan: 'sandbox',
        status: 'normal',
        created_at: 0,
        current: true,
      },
      {
        id: 'workspace-2',
        name: 'Evan Workspace',
        plan: 'team',
        status: 'normal',
        created_at: 0,
        current: false,
      },
    ]
    mockFetchWorkspaces.mockResolvedValue({ workspaces: mockWorkspaces })
    mockSwitchWorkspace.mockReturnValue(new Promise(() => {}))
    mockCurrentWorkspaceQuery()
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      enableEducationPlan: false,
      isFetchedPlan: true,
      plan: { type: 'sandbox' },
    } as ProviderContextState)
    mockWorkspacePermissionKeys(['workspace.member.manage'])
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
    } as unknown as ModalContextState)
  })

  it('includes the visible workspace name in the menu trigger accessible name', () => {
    renderWorkspaceCard()

    expect(screen.getByRole('button', { name: workspaceMenuAccessibleName })).toBeInTheDocument()
  })

  it('keeps full workspace names on the final interactive title owner', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard()

    const trigger = screen.getByRole('button', { name: workspaceMenuAccessibleName })
    expect(trigger).toHaveAttribute('title', 'Solar Studio')
    expect(within(trigger).getByText('Solar Studio')).not.toHaveAttribute('title')

    await user.click(trigger)

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    const workspaceItem = within(panel).getByRole('button', {
      name: 'Evan Workspace',
    })
    expect(workspaceItem).toHaveAttribute('title', 'Evan Workspace')
    expect(within(workspaceItem).getByText('Evan Workspace')).not.toHaveAttribute('title')
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' }),
    ).toHaveAttribute('title', 'common.mainNav.workspace.settings')
  })

  it('includes the visible workspace plan in the menu trigger accessible name', () => {
    renderWorkspaceCard({ systemFeatures: { deployment_edition: 'CLOUD' } })

    expect(
      screen.getByRole('button', {
        name: /Solar Studio.*sandbox.*common\.mainNav\.workspace\.openMenu/i,
      }),
    ).toBeInTheDocument()
  })

  it('hides cloud-only credits and upgrade actions outside cloud edition', () => {
    renderWorkspaceCard()

    expect(screen.getByRole('button', { name: workspaceMenuAccessibleName })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /common\.mainNav\.workspace\.credits/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  })

  it('links workspace credits to model provider settings in cloud edition', () => {
    renderWorkspaceCard({ systemFeatures: { deployment_edition: 'CLOUD' } })

    const creditsLink = screen.getByRole('link', {
      name: '7,500 common.mainNav.workspace.creditsUnit',
    })

    expect(creditsLink).toHaveAttribute('href', '/integrations/model-provider')
    expect(creditsLink).toHaveTextContent('7,500 common.mainNav.workspace.creditsUnit')
  })

  it('renders unlimited credits from the summary contract', () => {
    mockCurrentWorkspaceQuery({ ...currentWorkspaceValue, credits: -1 })

    renderWorkspaceCard({ systemFeatures: { deployment_edition: 'CLOUD' } })

    expect(screen.getByText('common.license.unlimited')).toBeInTheDocument()
  })

  it('hides the credits link when the summary has no effective credits', () => {
    mockCurrentWorkspaceQuery({ ...currentWorkspaceValue, credits: null })

    renderWorkspaceCard({ systemFeatures: { deployment_edition: 'CLOUD' } })

    expect(
      screen.queryByRole('link', { name: /common\.mainNav\.workspace\.credits/ }),
    ).not.toBeInTheDocument()
  })

  it('renders a stable skeleton while the current workspace is loading', () => {
    mockCurrentWorkspaceQuery(undefined, true)

    renderWorkspaceCard()

    expect(
      screen.queryByRole('button', { name: workspaceMenuAccessibleName }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Evan Workspace')).not.toBeInTheDocument()
  })

  it('renders the current workspace before loading the workspace list', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard({ seedWorkspaces: false })

    expect(screen.getByRole('button', { name: workspaceMenuAccessibleName })).toBeInTheDocument()
    expect(screen.getByText('Solar Studio')).toBeInTheDocument()
    expect(mockFetchWorkspaces).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    expect(await screen.findByRole('dialog', { name: 'Solar Studio' })).toBeInTheDocument()
    await waitFor(() => expect(mockFetchWorkspaces).toHaveBeenCalledOnce())
    expect(await screen.findByRole('button', { name: 'Evan Workspace' })).toBeInTheDocument()
  })

  it('prefetches the workspace list when the trigger is hovered', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard({ seedWorkspaces: false })

    const trigger = screen.getByRole('button', { name: workspaceMenuAccessibleName })
    await user.hover(trigger)

    await waitFor(() => expect(mockFetchWorkspaces).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: 'Solar Studio' })).not.toBeInTheDocument()

    await user.click(trigger)

    expect(await screen.findByRole('button', { name: 'Evan Workspace' })).toBeInTheDocument()
    expect(mockFetchWorkspaces).toHaveBeenCalledOnce()
  })

  it('prefetches the workspace list when the trigger receives keyboard focus', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard({ seedWorkspaces: false })

    await user.tab()

    expect(screen.getByRole('button', { name: workspaceMenuAccessibleName })).toHaveFocus()
    await waitFor(() => expect(mockFetchWorkspaces).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: 'Solar Studio' })).not.toBeInTheDocument()
  })

  it('keeps workspace controls visible and disabled while the workspace list is loading', async () => {
    const user = userEvent.setup()
    mockFetchWorkspaces.mockReturnValue(new Promise(() => {}))
    renderWorkspaceCard({ seedWorkspaces: false })

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(within(panel).getByText('common.userProfile.workspace')).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.sort.openMenu' }),
    ).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'common.operation.search' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(panel.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(within(panel).getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Evan Workspace' })).not.toBeInTheDocument()
  })

  it('uses the current workspace query for billing plan UI', () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      plan: 'team',
    })
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: false,
      enableEducationPlan: false,
      isFetchedPlan: true,
      plan: { type: 'sandbox' },
    } as ProviderContextState)
    renderWorkspaceCard({ systemFeatures: { deployment_edition: 'CLOUD' } })

    expect(screen.getByText('team')).toBeInTheDocument()
    expect(screen.getByText('billing.upgradeBtn.plain')).toBeInTheDocument()
    expect(screen.queryByText('sandbox')).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  })

  it('uses the original paid plan badge for paid workspaces', () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      plan: 'team',
    })
    renderWorkspaceCard({ systemFeatures: { deployment_edition: 'CLOUD' } })

    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('shows the Enterprise license status independently of the Cloud billing state', () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      plan: null,
    })
    renderWorkspaceCard({
      systemFeatures: {
        deployment_edition: 'ENTERPRISE',
      },
      systemFeaturesLicense: {
        status: zLicenseStatus.enum.active,
      },
    })

    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.queryByText('sandbox')).not.toBeInTheDocument()
  })

  it('opens workspace actions and switcher in a popover panel', async () => {
    renderWorkspaceCard()

    const workspaceTrigger = screen.getByRole('button', {
      name: workspaceMenuAccessibleName,
    })
    expect(workspaceTrigger).not.toHaveAttribute('data-popup-open')

    fireEvent.click(workspaceTrigger)

    expect(workspaceTrigger).toHaveAttribute('data-popup-open', '')

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveClass('w-[280px]')
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.inviteMembers' }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('common.userProfile.workspace')).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.sort.openMenu' }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'common.operation.search' }),
    ).toBeInTheDocument()
    const workspaceItem = within(panel).getByRole('button', { name: 'Evan Workspace' })
    expect(workspaceItem).toBeInTheDocument()
    const workspaceList = within(panel).getByRole('list', {
      name: 'common.userProfile.workspace',
    })
    expect(within(workspaceList).getAllByRole('listitem')).toHaveLength(2)
    expect(workspaceList.parentElement).toHaveClass('max-h-[240px]', 'overflow-y-auto')
  })

  it('filters workspace switcher options from the search action', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard()

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    const searchTrigger = await screen.findByRole('button', { name: 'common.operation.search' })
    expect(searchTrigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(searchTrigger)

    expect(screen.getByText('common.userProfile.workspace')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.mainNav.workspace.sort.openMenu' }),
    ).toBeInTheDocument()
    expect(searchTrigger).toHaveAttribute('aria-expanded', 'true')
    const controlledPanelId = searchTrigger.getAttribute('aria-controls')
    expect(controlledPanelId).toBeTruthy()

    const searchInput = screen.getByPlaceholderText('common.mainNav.workspace.searchPlaceholder')
    expect(document.getElementById(controlledPanelId!)).toContainElement(searchInput)
    expect(searchInput).toHaveFocus()
    await user.type(searchInput, 'evan')

    const panel = screen.getByRole('dialog', { name: 'Solar Studio' })
    expect(within(panel).getByRole('button', { name: 'Evan Workspace' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Solar Studio' })).not.toBeInTheDocument()
  })

  it('announces an empty workspace search result', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard()

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    await user.click(await screen.findByRole('button', { name: 'common.operation.search' }))
    await user.type(
      screen.getByPlaceholderText('common.mainNav.workspace.searchPlaceholder'),
      'missing',
    )

    const panel = screen.getByRole('dialog', { name: 'Solar Studio' })
    expect(within(panel).getByRole('status')).toHaveTextContent(
      'common.mainNav.workspace.noResults',
    )
    expect(
      within(panel).queryByRole('list', { name: 'common.userProfile.workspace' }),
    ).not.toBeInTheDocument()
  })

  it('exposes only the current workspace as current', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard()

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    const workspaceList = within(panel).getByRole('list', {
      name: 'common.userProfile.workspace',
    })
    expect(
      within(workspaceList).getByRole('button', { name: 'Solar Studio', current: true }),
    ).toBeInTheDocument()
    expect(
      within(workspaceList).getByRole('button', { name: 'Evan Workspace' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('sorts workspaces by last opened and can sort by created time', async () => {
    mockWorkspaces = [
      {
        id: 'workspace-1',
        name: 'Solar Studio',
        plan: 'sandbox',
        status: 'normal',
        created_at: 1,
        last_opened_at: 20,
        current: true,
      },
      {
        id: 'workspace-2',
        name: 'Evan Workspace',
        plan: 'team',
        status: 'normal',
        created_at: 3,
        last_opened_at: null,
        current: false,
      },
      {
        id: 'workspace-3',
        name: 'Atlas Workspace',
        plan: 'team',
        status: 'normal',
        created_at: 2,
        last_opened_at: 30,
        current: false,
      },
    ]
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    const workspaceList = within(panel).getByRole('list', {
      name: 'common.userProfile.workspace',
    })
    const defaultWorkspaceOptions = within(workspaceList)
      .getAllByRole('button')
      .map((item) => item.getAttribute('title'))
      .filter(Boolean)

    expect(defaultWorkspaceOptions).toEqual(['Atlas Workspace', 'Solar Studio', 'Evan Workspace'])

    const sortTrigger = screen.getByRole('button', {
      name: 'common.mainNav.workspace.sort.openMenu',
    })
    expect(sortTrigger).not.toHaveAttribute('data-popup-open')

    fireEvent.click(sortTrigger)

    expect(sortTrigger).toHaveAttribute('data-popup-open', '')

    expect(
      await screen.findByRole('menuitemradio', {
        name: 'common.mainNav.workspace.sort.lastOpened',
      }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: 'common.mainNav.workspace.sort.createdTime' }),
    )

    const createdTimeWorkspaceOptions = within(workspaceList)
      .getAllByRole('button')
      .map((item) => item.getAttribute('title'))
      .filter(Boolean)

    expect(createdTimeWorkspaceOptions).toEqual([
      'Evan Workspace',
      'Atlas Workspace',
      'Solar Studio',
    ])
  })

  it('closes the nested sort menu before the workspace popover on Escape', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard()

    const workspaceTrigger = screen.getByRole('button', { name: workspaceMenuAccessibleName })
    await user.click(workspaceTrigger)
    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    const sortTrigger = within(panel).getByRole('button', {
      name: 'common.mainNav.workspace.sort.openMenu',
    })
    await user.click(sortTrigger)
    expect(
      await screen.findByRole('menuitemradio', {
        name: 'common.mainNav.workspace.sort.lastOpened',
      }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(
      screen.queryByRole('menuitemradio', {
        name: 'common.mainNav.workspace.sort.lastOpened',
      }),
    ).not.toBeInTheDocument()
    expect(panel).toBeInTheDocument()
    expect(sortTrigger).toHaveFocus()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(panel).not.toBeInTheDocument())
    expect(workspaceTrigger).toHaveFocus()
  })

  it('opens account settings from workspace menu actions', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'common.mainNav.workspace.settings' }),
    )

    expect(mockSetSettingsDestination).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.BILLING)
  })

  it('opens members settings from workspace menu when billing is disabled', async () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      plan: null,
    })

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'common.mainNav.workspace.settings' }),
    )

    expect(mockSetSettingsDestination).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.MEMBERS)
    expect(mockSetSettingsDestination).not.toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.BILLING)
  })

  it('switches workspace from the workspace switcher item', async () => {
    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    fireEvent.click(await screen.findByRole('button', { name: 'Evan Workspace' }))

    await waitFor(() =>
      expect(mockSwitchWorkspace).toHaveBeenCalledWith({ body: { tenant_id: 'workspace-2' } }),
    )
  })

  it('closes the popover without switching when the current workspace is selected', async () => {
    const user = userEvent.setup()
    renderWorkspaceCard()

    await user.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))
    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    await user.click(within(panel).getByRole('button', { name: 'Solar Studio', current: true }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Solar Studio' })).not.toBeInTheDocument(),
    )
    expect(mockSwitchWorkspace).not.toHaveBeenCalled()
  })

  it('keeps workspace settings visible for dataset operators without member management permission', async () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      role: 'dataset_operator',
    })
    mockWorkspacePermissionKeys([])

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(panel).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' }),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'common.mainNav.workspace.inviteMembers' }),
    ).not.toBeInTheDocument()
  })

  it('shows invite members when member management permission is available', async () => {
    mockCurrentWorkspaceQuery({
      ...currentWorkspaceValue,
      role: 'normal',
    })
    mockWorkspacePermissionKeys(['workspace.member.manage'])

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.inviteMembers' }),
    ).toBeInTheDocument()
  })

  it('hides invite members when member management permission is missing', async () => {
    mockWorkspacePermissionKeys([])

    renderWorkspaceCard()

    fireEvent.click(screen.getByRole('button', { name: workspaceMenuAccessibleName }))

    const panel = await screen.findByRole('dialog', { name: 'Solar Studio' })
    expect(
      within(panel).getByRole('button', { name: 'common.mainNav.workspace.settings' }),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'common.mainNav.workspace.inviteMembers' }),
    ).not.toBeInTheDocument()
  })
})
