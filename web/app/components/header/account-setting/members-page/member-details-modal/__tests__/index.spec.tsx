import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import type { Role } from '@/models/access-control'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, renderWithConsoleQuery } from '@/test/console/query-data'
import MemberDetailsModal from '../index'

const { mockWorkspaceRoleListHook, mockRolesOfMemberHook } = vi.hoisted(() => ({
  mockWorkspaceRoleListHook: vi.fn(),
  mockRolesOfMemberHook: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': async () => mockWorkspaceRoleListHook().data.pages[0],
      'workspaces.current.rbac.members.byMemberId.rbacRoles.get': () => new Promise(() => {}),
    }),
  }
})

const createRole = (overrides: Partial<Role>): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Custom role',
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})
const member: AccountWithRoleResponse = {
  id: 'member-1',
  name: 'Admin User',
  email: 'admin@example.com',
  avatar: '',
  avatar_url: '',
  role: 'admin',
  roles: [createRole({ id: 'role-1', name: 'Custom role' })],
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  created_at: 1731000000,
  status: 'active',
}
const render = (ui: ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper()
  const response = mockRolesOfMemberHook().data
  if (response)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.get.queryKey({
        input: { params: { member_id: member.id }, query: { language: 'en' } },
      }),
      response,
    )
  return renderWithConsoleQuery(ui, { queryClient })
}

describe('MemberDetailsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockRolesOfMemberHook).mockReturnValue({
      data: {
        account_id: member.id,
        roles: [createRole({ id: 'role-1', name: 'Custom role' })],
      },
      isLoading: false,
    })
    vi.mocked(mockWorkspaceRoleListHook).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              createRole({ id: 'role-1', name: 'Custom role' }),
              createRole({ id: 'role-2', name: 'Second role' }),
            ],
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

  describe('Rendering', () => {
    it('should render edit role action when multiple roles are disabled', () => {
      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          allowMultipleRoles={false}
          onClose={vi.fn()}
          onAssignSubmit={vi.fn()}
        />,
      )

      const editButton = screen.getByRole('button', { name: /common\.operation\.edit/i })

      expect(editButton).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /members\.memberDetails\.assign/i }),
      ).not.toBeInTheDocument()
    })

    it('should render singular assigned role label when there is one role', () => {
      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          onClose={vi.fn()}
          onAssignSubmit={vi.fn()}
        />,
      )

      expect(
        screen.getByText(/workspaceMembers\.members\.memberDetails\.assignedRole:/i),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/workspaceMembers\.members\.memberDetails\.assignedRoles/i),
      ).not.toBeInTheDocument()
    })

    it('should render role loading state without assigned role chips or count', () => {
      vi.mocked(mockRolesOfMemberHook).mockReturnValue({
        data: undefined,
        isLoading: true,
      })

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          onClose={vi.fn()}
          onAssignSubmit={vi.fn()}
        />,
      )

      expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /members\.memberDetails\.assign/i }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Custom role')).not.toBeInTheDocument()
      expect(screen.queryByText('1')).not.toBeInTheDocument()
    })
  })

  describe('Role actions', () => {
    it('should keep role chips readonly when multiple roles are disabled', async () => {
      const user = userEvent.setup()

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          allowMultipleRoles={false}
          onClose={vi.fn()}
          onAssignSubmit={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /^Custom role$/i })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^Custom role$/i }))

      expect(
        screen.queryByRole('button', { name: /common\.operation\.remove/i }),
      ).not.toBeInTheDocument()
    })

    it('should not show role removal controls when role assignment is not allowed', () => {
      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles={false}
          onClose={vi.fn()}
          onAssignSubmit={vi.fn()}
        />,
      )

      expect(
        screen.queryByRole('button', { name: /members\.memberDetails\.assign/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /members\.memberDetails\.removeRoleAria/i }),
      ).not.toBeInTheDocument()
    })

    it('should submit pending role changes only after save is clicked', async () => {
      const user = userEvent.setup()
      const handleAssignSubmit = vi.fn()

      vi.mocked(mockRolesOfMemberHook).mockReturnValue({
        data: {
          account_id: member.id,
          roles: [
            createRole({ id: 'role-1', name: 'Custom role' }),
            createRole({ id: 'role-2', name: 'Second role' }),
          ],
        },
      })

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          onClose={vi.fn()}
          onAssignSubmit={handleAssignSubmit}
        />,
      )

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.remove.*Custom role/i }),
      )

      expect(handleAssignSubmit).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      expect(handleAssignSubmit).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'role-2', name: 'Second role' }),
      ])
    })

    it('should keep assigned role selections pending until save is clicked', async () => {
      const user = userEvent.setup()
      const handleAssignSubmit = vi.fn()

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          onClose={vi.fn()}
          onAssignSubmit={handleAssignSubmit}
        />,
      )

      await user.click(screen.getByRole('button', { name: /members\.memberDetails\.assign/i }))
      await user.click(await screen.findByRole('checkbox', { name: /Second role/i }))
      await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

      expect(handleAssignSubmit).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      expect(handleAssignSubmit).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'role-1', name: 'Custom role' }),
        expect.objectContaining({ id: 'role-2', name: 'Second role' }),
      ])
    })

    it('should replace the selected role when multiple roles are not allowed', async () => {
      const user = userEvent.setup()
      const handleAssignSubmit = vi.fn()

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          allowMultipleRoles={false}
          onClose={vi.fn()}
          onAssignSubmit={handleAssignSubmit}
        />,
      )

      await user.click(screen.getByRole('button', { name: /common\.operation\.edit/i }))
      await user.click(await screen.findByRole('radio', { name: /Second role/i }))
      await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      expect(handleAssignSubmit).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'role-2', name: 'Second role' }),
      ])
    })
  })
})
