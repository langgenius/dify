import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { useMembers } from '@/service/use-common'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MembersPage from '../index'

let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'COMMUNITY'
let memberFeatures: ConsoleQueryTestOptions['features'] = {}

const mockConsoleState = vi.hoisted(() => ({
  current: {} as Partial<ConsoleStateFixture>,
}))
const mockConsoleStateReader = vi.hoisted(() => vi.fn())

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/hooks/use-format-time-from-now')
vi.mock('@/service/access-control/use-member-roles')
vi.mock('@/service/use-common')
vi.mock('@/service/access-control/use-workspace-roles')
const { inviteMember } = vi.hoisted(() => ({ inviteMember: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, key) {
        if (key !== 'workspaces') return Reflect.get(target, key)
        return {
          current: {
            summary: target.workspaces.current.summary,
            members: {
              inviteEmail: {
                post: {
                  mutationOptions: (
                    options: Parameters<
                      typeof actual.consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions
                    >[0],
                  ) => ({ ...options, mutationFn: inviteMember }),
                },
              },
            },
          },
        }
      },
    }),
  }
})

const renderMembersPage = () =>
  renderWithConsoleQuery(<MembersPage />, {
    features: memberFeatures,
    accountProfile: mockConsoleState.current.userProfile,
    systemFeatures: { deployment_edition: deploymentEdition, is_email_setup: true },
  })

const getMemberDetailsButton = (memberId: string) =>
  within(screen.getByTestId(`member-row-${memberId}`)).getByRole('button', {
    name: memberId === '1' ? 'Owner User' : 'Admin User',
  })

const createRole = (overrides: Partial<Role>): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Role',
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

const setConsoleState = (value: ConsoleStateFixture) => {
  mockConsoleState.current = value
  mockConsoleStateReader.mockReturnValue(value)
}

vi.mock('../role-badges', () => ({
  default: ({ roleNames }: { roleNames: string[] }) => (
    <div data-testid="role-badges">{roleNames.join(',')}</div>
  ),
}))
vi.mock('../member-menu', () => ({
  default: ({
    member,
    isCurrentUser,
    onTransferOwnership,
    canTransferOwnership,
  }: {
    member: Member
    isCurrentUser?: boolean
    onTransferOwnership?: () => void
    canTransferOwnership?: boolean
  }) => (
    <div data-testid="member-menu">
      {member.role !== 'owner' && !isCurrentUser && <div>{`Member Operation ${member.role}`}</div>}
      {canTransferOwnership && member.role === 'owner' && onTransferOwnership && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTransferOwnership()
          }}
        >
          Transfer ownership
        </button>
      )}
    </div>
  ),
}))
vi.mock('../transfer-ownership-modal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <div>Transfer Ownership Modal</div>
      <button onClick={onClose}>Close Transfer Modal</button>
    </div>
  ),
}))
vi.mock('../member-details-modal', () => ({
  default: ({
    member,
    onClose,
    canAssignRoles,
    onAssignSubmit,
  }: {
    member: Member
    onClose: () => void
    canAssignRoles?: boolean
    onAssignSubmit?: (roles: Role[]) => void
  }) => (
    <div>
      <div>Member Details Modal</div>
      <div data-testid="details-member-name">{member.name}</div>
      <div data-testid="details-can-assign">{String(canAssignRoles)}</div>
      <button
        onClick={() =>
          onAssignSubmit?.([
            createRole({ id: 'role-next', name: 'Next role' }),
            createRole({ id: 'role-extra', name: 'Extra role' }),
          ])
        }
      >
        Submit Member Roles
      </button>
      <button onClick={onClose}>Close Member Details Modal</button>
    </div>
  ),
}))
vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <div>Upgrade Button</div>,
}))

describe('MembersPage', () => {
  const mockRefetch = vi.fn()
  const mockFormatTimeFromNow = vi.fn(() => 'just now')
  const mockUpdateRolesOfMember = vi.fn()

  const mockAccounts: Member[] = [
    {
      id: '1',
      name: 'Owner User',
      email: 'owner@example.com',
      avatar: '',
      avatar_url: '',
      role: 'owner',
      last_active_at: '1731000000',
      last_login_at: '1731000000',
      created_at: '1731000000',
      status: 'active',
      roles: [createRole({ id: 'owner-role', name: 'Owner', is_builtin: true, role_tag: 'owner' })],
    },
    {
      id: '2',
      name: 'Admin User',
      email: 'admin@example.com',
      avatar: '',
      avatar_url: '',
      role: 'admin',
      last_active_at: '1731000000',
      last_login_at: '1731000000',
      created_at: '1731000000',
      status: 'active',
      roles: [createRole({ id: 'admin-role', name: 'Admin', is_builtin: true })],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    setConsoleState({
      userProfile: { email: 'owner@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'owner' },
      isCurrentWorkspaceOwner: true,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as ConsoleStateFixture)

    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: mockAccounts },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)
    mockUpdateRolesOfMember.mockImplementation((_payload, options) => {
      options?.onSuccess?.()
      return Promise.resolve()
    })
    vi.mocked(useUpdateRolesOfMember).mockReturnValue({
      mutateAsync: mockUpdateRolesOfMember,
    } as unknown as ReturnType<typeof useUpdateRolesOfMember>)

    inviteMember.mockResolvedValue({
      result: 'success',
      tenant_id: 'tenant-id',
      invitation_results: [
        { email: 'sent@example.com', status: 'success', url: 'http://invite/link' },
      ],
    })
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: { pages: [{ data: [createRole({ id: 'admin', name: 'Admin' })] }] },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)
    deploymentEdition = 'COMMUNITY'
    memberFeatures = { ...memberFeatures, is_allow_transfer_workspace: true }

    vi.mocked(useFormatTimeFromNow).mockReturnValue({
      formatTimeFromNow: mockFormatTimeFromNow,
    })
  })

  it('should render workspace and member information', () => {
    renderMembersPage()

    expect(screen.getByText('Test Workspace'))!.toBeInTheDocument()
    expect(screen.getByText('Owner User'))!.toBeInTheDocument()
    expect(screen.getByText('Admin User'))!.toBeInTheDocument()
  })

  it('should expose member columns and keep row data separate from the details button', () => {
    renderMembersPage()

    const table = screen.getByRole('table')
    expect(
      within(table).getByRole('columnheader', { name: 'workspaceMembers.members.name' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'workspaceMembers.members.lastActive' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'workspaceMembers.members.role' }),
    ).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: /owner@example.com/ })
    expect(within(row).getByRole('cell', { name: 'just now' })).toBeInTheDocument()
    expect(within(row).getByRole('cell', { name: 'Owner' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Owner User' })).not.toHaveTextContent(
      'owner@example.com',
    )
  })

  it('should render plural roles column header when RBAC is enabled', () => {
    renderWithConsoleQuery(<MembersPage />, {
      features: memberFeatures,
      systemFeatures: {
        deployment_edition: deploymentEdition,
        is_email_setup: true,
        rbac_enabled: true,
      },
    })

    expect(
      screen.getByRole('columnheader', { name: 'workspaceMembers.members.roles' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('workspaceMembers.members.role', {
        selector: '.system-xs-medium-uppercase',
      }),
    ).not.toBeInTheDocument()
  })

  it('should open and close invite modal', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /invite/i }))
    expect(screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /operation\.close$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('should open invited modal after invite results are sent', async () => {
    const user = userEvent.setup()

    const { queryClient } = renderMembersPage()
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

    await user.click(screen.getByRole('button', { name: /members\.invite$/ }))
    await user.type(
      screen.getByRole('textbox', { name: /members\.emailRecipients/ }),
      'sent@example.com',
    )
    await user.click(screen.getByRole('combobox', { name: /members\.role/ }))
    await user.click(screen.getByRole('option', { name: /Admin/ }))
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/ }))

    expect(
      await screen.findByRole('dialog', { name: /members\.invitationSent$/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'http://invite/link' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /members\.ok$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('should open transfer ownership modal when transfer action is used', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /transfer ownership/i }))
    expect(screen.getByText('Transfer Ownership Modal'))!.toBeInTheDocument()
  })

  it('should show non-interactive owner role when transfer ownership is not allowed', () => {
    deploymentEdition = 'COMMUNITY'
    memberFeatures = { ...memberFeatures, is_allow_transfer_workspace: false }

    renderMembersPage()

    expect(screen.getByText('Owner'))!.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).not.toBeInTheDocument()
  })

  it('should hide manager controls for non-owner non-manager users', () => {
    setConsoleState({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' },
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: false,
    } as unknown as ConsoleStateFixture)

    renderMembersPage()

    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Transfer ownership')).not.toBeInTheDocument()
  })

  it('should open and close edit workspace modal', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /account\.editWorkspaceInfo/i }))
    expect(screen.getByRole('dialog', { name: /account\.editWorkspaceInfo/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /account\.workspaceName$/ })).toHaveValue(
      'Test Workspace',
    )

    await user.click(screen.getByRole('button', { name: /operation\.cancel$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('should close transfer ownership modal when close is clicked', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /transfer ownership/i }))
    expect(screen.getByText('Transfer Ownership Modal'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Transfer Modal' }))
    expect(screen.queryByText('Transfer Ownership Modal')).not.toBeInTheDocument()
  })

  it('should show pending status and you indicator', () => {
    const pendingAccount: Member = {
      ...mockAccounts[1]!,
      status: 'pending',
    }
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [mockAccounts[0], pendingAccount] },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    renderMembersPage()

    expect(screen.getByText(/members\.pending/i))!.toBeInTheDocument()
    expect(screen.getByText(/members\.you/i))!.toBeInTheDocument() // Current user is owner@example.com
  })

  it('should show billing information for limited plan', () => {
    deploymentEdition = 'CLOUD'
    memberFeatures = {
      billing: { subscription: { plan: 'sandbox' } },
      members: { size: 2, limit: 5 },
    }

    renderMembersPage()

    expect(screen.getByText(/plansCommon\.member/i))!.toBeInTheDocument()
    expect(screen.getByText('2'))!.toBeInTheDocument() // accounts.length
    expect(screen.getByText('/'))!.toBeInTheDocument()
    expect(screen.getByText('5'))!.toBeInTheDocument() // plan.total.teamMembers
  })

  it('should show unlimited billing information', () => {
    deploymentEdition = 'CLOUD'
    memberFeatures = {
      billing: { subscription: { plan: 'sandbox' } },
      members: { size: 2, limit: 0 },
    }

    renderMembersPage()

    expect(screen.getByText(/plansCommon\.unlimited/i))!.toBeInTheDocument()
  })

  it('should show non-billing member format for team plan even when billing is enabled', () => {
    deploymentEdition = 'CLOUD'
    memberFeatures = {
      billing: { subscription: { plan: 'team' } },
      members: { size: 2, limit: 50 },
    }

    renderMembersPage()

    // 'team' is an unlimited member plan → isNotUnlimitedMemberPlan=false → non-billing layout
    // 'team' is an unlimited member plan → isNotUnlimitedMemberPlan=false → non-billing layout
    expect(screen.getByText(/plansCommon\.memberAfter/i))!.toBeInTheDocument()
  })

  it('should show invite button when user is manager but not owner', () => {
    setConsoleState({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' },
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as ConsoleStateFixture)

    renderMembersPage()

    expect(screen.getByRole('button', { name: /invite/i }))!.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).not.toBeInTheDocument()
  })

  it('should allow admins to operate other non-owner members only', () => {
    setConsoleState({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' },
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as ConsoleStateFixture)
    vi.mocked(useMembers).mockReturnValue({
      data: {
        accounts: [
          mockAccounts[0],
          mockAccounts[1],
          {
            ...mockAccounts[1]!,
            id: '3',
            email: 'editor@example.com',
            name: 'Editor User',
            role: 'editor',
          },
          {
            ...mockAccounts[1]!,
            id: '4',
            email: 'normal@example.com',
            name: 'Normal User',
            role: 'normal',
          },
          {
            ...mockAccounts[1]!,
            id: '5',
            email: 'dataset@example.com',
            name: 'Dataset User',
            role: 'dataset_operator',
          },
          {
            ...mockAccounts[1]!,
            id: '6',
            email: 'other-admin@example.com',
            name: 'Other Admin User',
            role: 'admin',
          },
        ],
      },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    renderMembersPage()

    expect(screen.getByText('Member Operation editor'))!.toBeInTheDocument()
    expect(screen.getByText('Member Operation normal'))!.toBeInTheDocument()
    expect(screen.getByText('Member Operation dataset_operator'))!.toBeInTheDocument()
    expect(screen.getByText('Member Operation admin'))!.toBeInTheDocument()
    expect(screen.queryByText('Member Operation owner')).not.toBeInTheDocument()
  })

  it('should use created_at as fallback when last_active_at is empty', () => {
    const memberNoLastActive: Member = {
      ...mockAccounts[1]!,
      last_active_at: '',
      created_at: '1700000000',
    }
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [memberNoLastActive] },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    renderMembersPage()

    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1700000000000)
  })

  it('should not show plural s when only one account in billing layout', () => {
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [mockAccounts[0]] },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)
    deploymentEdition = 'CLOUD'
    memberFeatures = {
      billing: { subscription: { plan: 'sandbox' } },
      members: { size: 2, limit: 5 },
    }

    renderMembersPage()

    expect(screen.getByText(/plansCommon\.member/i))!.toBeInTheDocument()
    expect(screen.getByText('1'))!.toBeInTheDocument()
  })

  it('should not show plural s when only one account in non-billing layout', () => {
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [mockAccounts[0]] },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    renderMembersPage()

    expect(screen.getByText(/plansCommon\.memberAfter/i))!.toBeInTheDocument()
    expect(screen.getByText('1'))!.toBeInTheDocument()
  })

  it('should render role badge names from account roles', () => {
    setConsoleState({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' },
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: false,
    } as unknown as ConsoleStateFixture)
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [{ ...mockAccounts[1], role: 'unknown_role' as Member['role'] }] },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    renderMembersPage()

    expect(screen.getByText('Admin'))!.toBeInTheDocument()
  })

  it('should expose a member details button without nesting member actions', () => {
    renderMembersPage()

    const row = screen.getByTestId('member-row-2')
    const detailsButton = getMemberDetailsButton('2')
    const memberMenu = within(row).getByTestId('member-menu')

    expect(row).not.toHaveAttribute('role', 'button')
    expect(detailsButton).toHaveAttribute('type', 'button')
    expect(detailsButton).not.toContainElement(memberMenu)
  })

  it('should open member details modal when a member name is clicked', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(getMemberDetailsButton('2'))

    expect(screen.getByText('Member Details Modal'))!.toBeInTheDocument()
    expect(screen.getByTestId('details-member-name'))!.toHaveTextContent('Admin User')

    await user.click(screen.getByRole('button', { name: 'Close Member Details Modal' }))
    expect(screen.queryByText('Member Details Modal')).not.toBeInTheDocument()
  })

  it('should open member details modal via keyboard Enter', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    const detailsButton = getMemberDetailsButton('2')
    detailsButton.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByText('Member Details Modal'))!.toBeInTheDocument()
  })

  it('should not allow assigning roles from member details when target is owner', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(getMemberDetailsButton('1'))

    expect(screen.getByTestId('details-can-assign'))!.toHaveTextContent('false')
  })

  it('should not allow assigning roles from member details when target is current user', async () => {
    const user = userEvent.setup()
    setConsoleState({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' },
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as ConsoleStateFixture)

    renderMembersPage()

    await user.click(getMemberDetailsButton('2'))

    expect(screen.getByTestId('details-can-assign'))!.toHaveTextContent('false')
  })

  it('should submit only one member role when RBAC is disabled', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(getMemberDetailsButton('2'))
    await user.click(screen.getByRole('button', { name: 'Submit Member Roles' }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith(
      {
        memberId: '2',
        roleIds: ['role-next'],
      },
      expect.any(Object),
    )
    expect(mockRefetch).toHaveBeenCalled()
    expect(screen.getByText('Member Details Modal')).toBeInTheDocument()
    expect(screen.getByTestId('details-member-name')).toHaveTextContent('Admin User')
  })

  it('should submit multiple member roles when RBAC is enabled', async () => {
    const user = userEvent.setup()

    renderWithConsoleQuery(<MembersPage />, {
      features: memberFeatures,
      systemFeatures: {
        deployment_edition: deploymentEdition,
        is_email_setup: true,
        rbac_enabled: true,
      },
    })

    await user.click(getMemberDetailsButton('2'))
    await user.click(screen.getByRole('button', { name: 'Submit Member Roles' }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith(
      {
        memberId: '2',
        roleIds: ['role-next', 'role-extra'],
      },
      expect.any(Object),
    )
  })

  it('should not open member details when clicking the member menu area', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /transfer ownership/i }))

    expect(screen.queryByText('Member Details Modal')).not.toBeInTheDocument()
  })

  it('should show the upgrade action without blocking the backend-authoritative invite flow', async () => {
    const user = userEvent.setup()
    deploymentEdition = 'CLOUD'
    memberFeatures = {
      billing: { subscription: { plan: 'sandbox' } },
      members: { size: 2, limit: 2 },
    }

    renderMembersPage()

    expect(screen.getByText('Upgrade Button'))!.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /members\.invite$/ }))
    expect(screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })).toBeInTheDocument()
  })
})
