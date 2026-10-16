import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient, consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MemberMenu from '../member-menu'

const { mockWorkspaceRoleListHook, mockUpdateRolesOfMemberHook } = vi.hoisted(() => ({
  mockWorkspaceRoleListHook: vi.fn(),
  mockUpdateRolesOfMemberHook: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.rbac.roles.get': () => mockWorkspaceRoleListHook(),
    'workspaces.current.rbac.members.byMemberId.rbacRoles.put': () => mockUpdateRolesOfMemberHook(),
  })
})

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    workspaces: {
      current: {
        members: {
          byMemberId: {
            delete: vi.fn(),
          },
        },
      },
    },
  },
}))
vi.mock('@/app/notifications', () => ({
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
  const mockUpdateRolesOfMember = vi.fn()

  const createQueryClient = () =>
    new QueryClient({
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
    vi.mocked(consoleClient.workspaces.current.members.byMemberId.delete).mockResolvedValue({
      result: 'success',
      tenant_id: 'tenant-1',
    })
    vi.mocked(mockUpdateRolesOfMemberHook).mockReturnValue({
      mutateAsync: mockUpdateRolesOfMember,
    })
    vi.mocked(mockWorkspaceRoleListHook).mockReturnValue({
      data: {
        pages: [
          {
            data: roles,
            pagination: {
              total_count: 2,
              per_page: 20,
              current_page: 1,
              total_pages: 1,
            },
          },
        ],
        pageParams: [1],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    })
  })

  it('should show edit role copy when multiple roles are disabled', async () => {
    const user = userEvent.setup()

    renderWithConsoleQuery(
      <MemberMenu member={member} isCurrentUser={false} allowMultipleRoles={false} />,
      {
        systemFeatures: {
          rbac_enabled: false,
        },
      },
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))

    expect(
      screen.getByRole('menuitem', { name: /workspaceMembers\.members\.editRole/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /workspaceMembers\.members\.assignRoles/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /workspaceMembers\.members\.editRole/i }))

    expect(
      screen.getByRole('dialog', { name: /workspaceMembers\.members\.editRole/i }),
    ).toBeInTheDocument()
  })

  it('should submit only one selected role from the assign modal when RBAC is disabled', async () => {
    const user = userEvent.setup()

    renderWithConsoleQuery(
      <MemberMenu member={member} isCurrentUser={false} allowMultipleRoles={false} />,
      {
        systemFeatures: {
          rbac_enabled: false,
        },
      },
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.editRole/i }))
    await user.click(screen.getByRole('radio', { name: /Second role/i }))
    await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

    expect(mockUpdateRolesOfMember).toHaveBeenCalledWith(
      {
        params: { member_id: 'member-1' },
        body: { role_ids: ['role-2'] },
      },
      expect.any(Object),
    )
  })

  it('should require confirmation before removing a member', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const { queryKey: membersQueryKey } = consoleQuery.workspaces.current.members.get.queryOptions({
      input: { query: { language: 'en' } },
    })
    queryClient.setQueryData(membersQueryKey, { accounts: [member] })

    renderWithConsoleQuery(<MemberMenu member={member} isCurrentUser={false} />, {
      queryClient,
    })

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))

    const dialog = screen.getByRole('alertdialog', {
      name: /workspaceMembers\.members\.removeFromTeamConfirmTitle:\{"memberName":"Member User"\}/i,
    })
    expect(dialog).toHaveTextContent('workspaceMembers.members.removeFromTeamConfirmDescription')
    expect(consoleClient.workspaces.current.members.byMemberId.delete).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /common\.operation\.confirm/i }))

    await waitFor(() => {
      expect(consoleClient.workspaces.current.members.byMemberId.delete).toHaveBeenCalledWith({
        params: { member_id: 'member-1' },
      })
    })
    expect(queryClient.getQueryState(membersQueryKey)?.isInvalidated).toBe(true)
  })
})
