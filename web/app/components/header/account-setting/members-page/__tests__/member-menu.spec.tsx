import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MemberMenu from '../member-menu'

const { mockWorkspaceRoleListHook, mockUpdateRolesOfMember } = vi.hoisted(() => ({
  mockWorkspaceRoleListHook: vi.fn(),
  mockUpdateRolesOfMember: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.members.byMemberId.rbacRoles.put': mockUpdateRolesOfMember,
      'workspaces.current.rbac.roles.get': mockWorkspaceRoleListHook,
    }),
  }
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

const roles = [
  createRole({ id: 'role-1', name: 'First role' }),
  createRole({ id: 'role-2', name: 'Second role' }),
]

const member: AccountWithRoleResponse = {
  id: 'member-1',
  name: 'Member User',
  email: 'member@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [roles[0]!],
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  created_at: 1731000000,
  status: 'active',
}

describe('MemberMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateRolesOfMember.mockResolvedValue(undefined)
    mockWorkspaceRoleListHook.mockResolvedValue({
      data: roles,
      pagination: { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 },
    })
  })

  it('should submit only one selected role from the assign modal when RBAC is disabled', async () => {
    const user = userEvent.setup()

    renderWithConsoleQuery(
      <MemberMenu
        onRemove={vi.fn()}
        member={member}
        isCurrentUser={false}
        allowMultipleRoles={false}
      />,
      {
        systemFeatures: {
          rbac_enabled: false,
        },
      },
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.editRole/i }))
    await user.click(await screen.findByRole('option', { name: /Second role/i }))
    await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith({
      params: { member_id: 'member-1' },
      body: { role_ids: ['role-2'] },
    })
  })

  it('keeps the role draft and loading state until the request succeeds, with retryable inline errors', async () => {
    const user = userEvent.setup()
    let rejectSave!: (error: Error) => void
    mockUpdateRolesOfMember.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    renderWithConsoleQuery(
      <MemberMenu
        onRemove={vi.fn()}
        member={member}
        isCurrentUser={false}
        allowMultipleRoles={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /members\.memberActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /members\.editRole/ }))
    const second = await screen.findByRole('option', { name: /Second role/ })
    await user.click(second)
    const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
    expect(confirm).toHaveFocus()
    expect(screen.getByRole('combobox')).toHaveAttribute('readonly')
    await user.click(confirm)
    await user.click(screen.getByRole('option', { name: /First role/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(mockUpdateRolesOfMember).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeEnabled()
    await act(async () => rejectSave(new Error('Save failed')))
    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(confirm).not.toHaveAttribute('aria-disabled', 'true')
    expect(second).toHaveAttribute('aria-selected', 'true')
    await user.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockUpdateRolesOfMember).toHaveBeenLastCalledWith({
      params: { member_id: member.id },
      body: { role_ids: ['role-2'] },
    })
  })

  it('allows dismissal while saving without permitting another edit until the request settles', async () => {
    const user = userEvent.setup()
    let rejectSave!: (error: Error) => void
    mockUpdateRolesOfMember.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    renderWithConsoleQuery(
      <MemberMenu
        onRemove={vi.fn()}
        member={member}
        isCurrentUser={false}
        allowMultipleRoles={false}
      />,
    )
    const more = screen.getByRole('button', { name: /members\.memberActions/ })
    await user.click(more)
    await user.click(screen.getByRole('menuitem', { name: /members\.editRole/ }))
    await user.click(await screen.findByRole('option', { name: /Second role/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(mockUpdateRolesOfMember).toHaveBeenCalledOnce())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(more)
    const edit = screen.getByRole('menuitem', { name: /members\.editRole/ })
    expect(edit).toHaveAttribute('aria-disabled', 'true')
    await user.click(edit)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => rejectSave(new Error('Save failed')))
    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    await waitFor(() => expect(edit).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(edit)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /First role/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(mockUpdateRolesOfMember).toHaveBeenCalledOnce()
  })

  it('resets a failed mutation when the dialog closes and starts a fresh session on reopen', async () => {
    const user = userEvent.setup()
    mockUpdateRolesOfMember.mockRejectedValueOnce(new Error('Save failed'))
    renderWithConsoleQuery(
      <MemberMenu
        onRemove={vi.fn()}
        member={member}
        isCurrentUser={false}
        allowMultipleRoles={false}
      />,
    )
    const open = async () => {
      await user.click(screen.getByRole('button', { name: /members\.memberActions/ }))
      await user.click(screen.getByRole('menuitem', { name: /members\.editRole/ }))
      await screen.findByRole('option', { name: /First role/ })
    }
    await open()
    await user.click(screen.getByRole('option', { name: /Second role/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await open()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /First role/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('asks the list to confirm removal of this member', async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()
    renderWithConsoleQuery(<MemberMenu member={member} isCurrentUser={false} onRemove={onRemove} />)
    const trigger = screen.getByRole('button', { name: /members\.memberActions/i })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
