import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { deleteMemberOrCancelInvitation } from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import MemberMenu from '../member-menu'

vi.mock('@/service/access-control/use-member-roles')
vi.mock('@/service/access-control/use-workspace-roles')
vi.mock('@/service/common', () => ({
  deleteMemberOrCancelInvitation: vi.fn(),
}))
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

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

const member: Member = {
  id: 'member-1',
  name: 'Member User',
  email: 'member@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [roles[0]!],
  last_active_at: '1731000000',
  last_login_at: '1731000000',
  created_at: '1731000000',
  status: 'active',
}

describe('MemberMenu', () => {
  const mockUpdateRolesOfMember = vi.fn()

  const createQueryClient = () => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateRolesOfMember.mockResolvedValue(undefined)
    vi.mocked(deleteMemberOrCancelInvitation).mockResolvedValue({ result: 'success' })
    vi.mocked(useUpdateRolesOfMember).mockReturnValue({
      mutateAsync: mockUpdateRolesOfMember,
    } as unknown as ReturnType<typeof useUpdateRolesOfMember>)
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: {
        pages: [{
          data: roles,
          pagination: {
            total_count: 2,
            per_page: 20,
            current_page: 1,
            total_pages: 1,
          },
        }],
        pageParams: [1],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)
  })

  it('should submit only one selected role from the assign modal when RBAC is disabled', async () => {
    const user = userEvent.setup()

    renderWithSystemFeatures(
      <MemberMenu
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
    await user.click(screen.getByRole('menuitem', { name: /members\.assignRoles/i }))
    await user.click(screen.getByRole('radio', { name: /Second role/i }))
    await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith({
      memberId: 'member-1',
      roleIds: ['role-2'],
    }, expect.any(Object))
  })

  it('should refresh and invalidate members after removing a member', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const membersQueryKey = [...commonQueryKeys.members, 'en-US']
    queryClient.setQueryData(membersQueryKey, { accounts: [member] })

    renderWithSystemFeatures(
      <MemberMenu
        member={member}
        isCurrentUser={false}
      />,
      {
        queryClient,
      },
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))

    expect(deleteMemberOrCancelInvitation).toHaveBeenCalledWith({
      url: '/workspaces/current/members/member-1',
    })
    expect(queryClient.getQueryState(membersQueryKey)?.isInvalidated).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
  })
})
