import type { Role, RoleListResponse } from '@/models/access-control'
import type { Member } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { useMembers } from '@/service/use-common'
import AddRuleTargetsModal from '../index'

vi.mock('@/service/access-control/use-workspace-roles')
vi.mock('@/service/use-common')

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

const createMember = (overrides: Partial<Member>): Member => ({
  id: 'member-1',
  name: 'Member',
  email: 'member@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [],
  last_active_at: '1731000000',
  last_login_at: '1731000000',
  created_at: '1731000000',
  status: 'active',
  ...overrides,
})

const rolePage: RoleListResponse = {
  data: [
    createRole({ id: 'locked-role', name: 'Locked role' }),
    createRole({ id: 'editable-role', name: 'Editable role' }),
  ],
  pagination: {
    total_count: 2,
    per_page: 20,
    current_page: 1,
    total_pages: 1,
  },
}

describe('AddRuleTargetsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: { pages: [rolePage], pageParams: [1] },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)
    vi.mocked(useMembers).mockReturnValue({
      data: {
        accounts: [
          createMember({ id: 'locked-member', name: 'Locked member', email: 'locked@example.com' }),
          createMember({ id: 'editable-member', name: 'Editable member', email: 'editable@example.com' }),
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMembers>)
  })

  it('should not toggle locked role and member bindings', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn()

    render(
      <AddRuleTargetsModal
        ruleName="App rule"
        initialRoleIds={['locked-role', 'editable-role']}
        initialMemberIds={['locked-member', 'editable-member']}
        lockedRoleIds={['locked-role']}
        lockedMemberIds={['locked-member']}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    )

    const lockedRole = screen.getByRole('checkbox', { name: /Locked role/i })
    const editableRole = screen.getByRole('checkbox', { name: /Editable role/i })
    expect(lockedRole).toHaveAttribute('aria-disabled', 'true')

    await user.click(lockedRole)
    await user.click(editableRole)

    await user.click(screen.getByRole('tab', { name: /permission\.addRuleTargets\.membersTab/i }))

    const lockedMember = screen.getByRole('checkbox', { name: /Locked member/i })
    const editableMember = screen.getByRole('checkbox', { name: /Editable member/i })
    expect(lockedMember).toHaveAttribute('aria-disabled', 'true')

    await user.click(lockedMember)
    await user.click(editableMember)

    await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

    expect(handleSubmit).toHaveBeenCalledWith({
      roleIds: ['locked-role'],
      memberIds: ['locked-member'],
    })
  })
})
