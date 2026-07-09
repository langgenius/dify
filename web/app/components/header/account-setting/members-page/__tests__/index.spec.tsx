import type { AppContextStateMockState } from '@/__tests__/utils/mock-app-context-state'
import type { Role } from '@/models/access-control'
import type { ICurrentWorkspace, Member } from '@/models/common'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { useMembers } from '@/service/use-common'
import MembersPage from '../index'

const mockAppContextState = vi.hoisted(() => ({
  current: {} as Partial<AppContextStateMockState>,
}))
const mockUseAppContext = vi.hoisted(() => vi.fn())

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})
vi.mock('@/context/provider-context')
vi.mock('@/hooks/use-format-time-from-now')
vi.mock('@/service/access-control/use-member-roles')
vi.mock('@/service/use-common')

const renderMembersPage = () => renderWithSystemFeatures(<MembersPage />, {
  systemFeatures: { is_email_setup: true },
})

const getMemberDetailsButton = (memberId: string) => within(screen.getByTestId(`member-row-${memberId}`)).getByRole('button', {
  name: /members\.memberDetails\.openAria/i,
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

const setAppContextValue = (value: AppContextStateMockState) => {
  mockAppContextState.current = value
  mockUseAppContext.mockReturnValue(value)
}

vi.mock('../edit-workspace-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      <div>Edit Workspace Modal</div>
      <button onClick={onCancel}>Close Edit Workspace</button>
    </div>
  ),
}))
vi.mock('../invite-button', () => ({
  default: ({ onClick, disabled }: { onClick: () => void, disabled: boolean }) => (
    <button onClick={onClick} disabled={disabled}>Invite</button>
  ),
}))
vi.mock('../invite-modal', () => ({
  default: ({ onCancel, onSend }: { onCancel: () => void, onSend: (results: Array<{ email: string, status: 'success', url: string }>) => void }) => (
    <div>
      <div>Invite Modal</div>
      <button onClick={onCancel}>Close Invite Modal</button>
      <button onClick={() => onSend([{ email: 'sent@example.com', status: 'success', url: 'http://invite/link' }])}>Send Invite Results</button>
    </div>
  ),
}))
vi.mock('../invited-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      <div>Invited Modal</div>
      <button onClick={onCancel}>Close Invited Modal</button>
    </div>
  ),
}))
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
      {member.role !== 'owner' && !isCurrentUser && (
        <div>{`Member Operation ${member.role}`}</div>
      )}
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
      <button onClick={() => onAssignSubmit?.([
        createRole({ id: 'role-next', name: 'Next role' }),
        createRole({ id: 'role-extra', name: 'Extra role' }),
      ])}
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

    setAppContextValue({
      userProfile: { email: 'owner@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'owner' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: true,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as AppContextStateMockState)

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

    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: false,
      isAllowTransferWorkspace: true,
    }))

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

  it('should render fixed name column and flexible role column layout', () => {
    renderMembersPage()

    expect(screen.getByText('common.members.name', { selector: '.system-xs-medium-uppercase' }))!.toHaveClass('w-65', 'shrink-0')
    expect(screen.getByText('common.members.role', { selector: '.system-xs-medium-uppercase' }))!.toHaveClass('min-w-0', 'grow')
    expect(getMemberDetailsButton('1').children[0])!.toHaveClass('w-65', 'shrink-0')
    expect(getMemberDetailsButton('1').children[2])!.toHaveClass('min-w-0', 'grow')
  })

  it('should render plural roles column header when RBAC is enabled', () => {
    renderWithSystemFeatures(<MembersPage />, {
      systemFeatures: {
        is_email_setup: true,
        rbac_enabled: true,
      },
    })

    expect(screen.getByText('common.members.roles', { selector: '.system-xs-medium-uppercase' }))!.toHaveClass('min-w-0', 'grow')
    expect(screen.queryByText('common.members.role', { selector: '.system-xs-medium-uppercase' })).not.toBeInTheDocument()
  })

  it('should open and close invite modal', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /invite/i }))
    expect(screen.getByText('Invite Modal'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Invite Modal' }))
    expect(screen.queryByText('Invite Modal')).not.toBeInTheDocument()
  })

  it('should open invited modal after invite results are sent', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /invite/i }))
    await user.click(screen.getByRole('button', { name: 'Send Invite Results' }))

    expect(screen.getByText('Invited Modal'))!.toBeInTheDocument()
    expect(mockRefetch).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close Invited Modal' }))
    expect(screen.queryByText('Invited Modal')).not.toBeInTheDocument()
  })

  it('should open transfer ownership modal when transfer action is used', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /transfer ownership/i }))
    expect(screen.getByText('Transfer Ownership Modal'))!.toBeInTheDocument()
  })

  it('should show non-interactive owner role when transfer ownership is not allowed', () => {
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: false,
      isAllowTransferWorkspace: false,
    }))

    renderMembersPage()

    expect(screen.getByText('Owner'))!.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).not.toBeInTheDocument()
  })

  it('should hide manager controls for non-owner non-manager users', () => {
    setAppContextValue({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: false,
    } as unknown as AppContextStateMockState)

    renderMembersPage()

    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Transfer ownership')).not.toBeInTheDocument()
  })

  it('should open and close edit workspace modal', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /account\.editWorkspaceInfo/i }))
    expect(screen.getByText('Edit Workspace Modal'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Edit Workspace' }))
    expect(screen.queryByText('Edit Workspace Modal')).not.toBeInTheDocument()
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
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: true,
      plan: {
        type: Plan.sandbox,
        total: { teamMembers: 5 } as unknown as ReturnType<typeof useProviderContext>['plan']['total'],
      } as unknown as ReturnType<typeof useProviderContext>['plan'],
    }))

    renderMembersPage()

    expect(screen.getByText(/plansCommon\.member/i))!.toBeInTheDocument()
    expect(screen.getByText('2'))!.toBeInTheDocument() // accounts.length
    expect(screen.getByText('/'))!.toBeInTheDocument()
    expect(screen.getByText('5'))!.toBeInTheDocument() // plan.total.teamMembers
  })

  it('should show unlimited billing information', () => {
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: true,
      plan: {
        type: Plan.sandbox,
        total: { teamMembers: -1 } as unknown as ReturnType<typeof useProviderContext>['plan']['total'],
      } as unknown as ReturnType<typeof useProviderContext>['plan'],
    }))

    renderMembersPage()

    expect(screen.getByText(/plansCommon\.unlimited/i))!.toBeInTheDocument()
  })

  it('should show non-billing member format for team plan even when billing is enabled', () => {
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: true,
      plan: {
        type: Plan.team,
        total: { teamMembers: 50 } as unknown as ReturnType<typeof useProviderContext>['plan']['total'],
      } as unknown as ReturnType<typeof useProviderContext>['plan'],
    }))

    renderMembersPage()

    // Plan.team is an unlimited member plan → isNotUnlimitedMemberPlan=false → non-billing layout
    // Plan.team is an unlimited member plan → isNotUnlimitedMemberPlan=false → non-billing layout
    expect(screen.getByText(/plansCommon\.memberAfter/i))!.toBeInTheDocument()
  })

  it('should show invite button when user is manager but not owner', () => {
    setAppContextValue({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as AppContextStateMockState)

    renderMembersPage()

    expect(screen.getByRole('button', { name: /invite/i }))!.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).not.toBeInTheDocument()
  })

  it('should allow admins to operate other non-owner members only', () => {
    setAppContextValue({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as AppContextStateMockState)
    vi.mocked(useMembers).mockReturnValue({
      data: {
        accounts: [
          mockAccounts[0],
          mockAccounts[1],
          { ...mockAccounts[1]!, id: '3', email: 'editor@example.com', name: 'Editor User', role: 'editor' },
          { ...mockAccounts[1]!, id: '4', email: 'normal@example.com', name: 'Normal User', role: 'normal' },
          { ...mockAccounts[1]!, id: '5', email: 'dataset@example.com', name: 'Dataset User', role: 'dataset_operator' },
          { ...mockAccounts[1]!, id: '6', email: 'other-admin@example.com', name: 'Other Admin User', role: 'admin' },
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
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: true,
      plan: {
        type: Plan.sandbox,
        total: { teamMembers: 5 } as unknown as ReturnType<typeof useProviderContext>['plan']['total'],
      } as unknown as ReturnType<typeof useProviderContext>['plan'],
    }))

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
    setAppContextValue({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: false,
    } as unknown as AppContextStateMockState)
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [{ ...mockAccounts[1], role: 'unknown_role' as Member['role'] }] },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    renderMembersPage()

    expect(screen.getByText('Admin'))!.toBeInTheDocument()
  })

  it('should expose member details as a native row button without nesting member actions', () => {
    renderMembersPage()

    const row = screen.getByTestId('member-row-2')
    const detailsButton = getMemberDetailsButton('2')
    const memberMenu = within(row).getByTestId('member-menu')

    expect(row).not.toHaveAttribute('role', 'button')
    expect(row).not.toHaveClass('hover:bg-state-base-hover')
    expect(detailsButton).toHaveAttribute('type', 'button')
    expect(detailsButton).toHaveClass('hover:bg-state-base-hover', 'focus-visible:bg-state-base-hover')
    expect(detailsButton).not.toContainElement(memberMenu)
  })

  it('should open member details modal when a member row is clicked', async () => {
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
    setAppContextValue({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['workspace.member.manage'],
    } as unknown as AppContextStateMockState)

    renderMembersPage()

    await user.click(getMemberDetailsButton('2'))

    expect(screen.getByTestId('details-can-assign'))!.toHaveTextContent('false')
  })

  it('should submit only one member role when RBAC is disabled', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(getMemberDetailsButton('2'))
    await user.click(screen.getByRole('button', { name: 'Submit Member Roles' }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith({
      memberId: '2',
      roleIds: ['role-next'],
    }, expect.any(Object))
    expect(mockRefetch).toHaveBeenCalled()
    expect(screen.getByText('Member Details Modal')).toBeInTheDocument()
    expect(screen.getByTestId('details-member-name')).toHaveTextContent('Admin User')
  })

  it('should submit multiple member roles when RBAC is enabled', async () => {
    const user = userEvent.setup()

    renderWithSystemFeatures(<MembersPage />, {
      systemFeatures: {
        is_email_setup: true,
        rbac_enabled: true,
      },
    })

    await user.click(getMemberDetailsButton('2'))
    await user.click(screen.getByRole('button', { name: 'Submit Member Roles' }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith({
      memberId: '2',
      roleIds: ['role-next', 'role-extra'],
    }, expect.any(Object))
  })

  it('should not open member details when clicking the member menu area', async () => {
    const user = userEvent.setup()

    renderMembersPage()

    await user.click(screen.getByRole('button', { name: /transfer ownership/i }))

    expect(screen.queryByText('Member Details Modal')).not.toBeInTheDocument()
  })

  it('should show upgrade button when member limit is full', () => {
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: true,
      plan: {
        type: Plan.sandbox,
        total: { teamMembers: 2 } as unknown as ReturnType<typeof useProviderContext>['plan']['total'],
      } as unknown as ReturnType<typeof useProviderContext>['plan'],
    }))

    renderMembersPage()

    expect(screen.getByText('Upgrade Button'))!.toBeInTheDocument()
  })
})
