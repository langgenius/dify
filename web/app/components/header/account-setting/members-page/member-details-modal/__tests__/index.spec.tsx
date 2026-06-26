import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useRolesOfMember } from '@/service/access-control/use-member-roles'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import MemberDetailsModal from '../index'

vi.mock('@/service/access-control/use-member-roles')
vi.mock('@/service/access-control/use-workspace-roles')

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

const member: Member = {
  id: 'member-1',
  name: 'Admin User',
  email: 'admin@example.com',
  avatar: '',
  avatar_url: '',
  role: 'admin',
  roles: [
    createRole({ id: 'role-1', name: 'Custom role' }),
  ],
  last_active_at: '1731000000',
  last_login_at: '1731000000',
  created_at: '1731000000',
  status: 'active',
}

describe('MemberDetailsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRolesOfMember).mockReturnValue({
      data: {
        account_id: member.id,
        roles: [
          createRole({ id: 'role-1', name: 'Custom role' }),
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useRolesOfMember>)
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: {
        pages: [{
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
      expect(screen.queryByRole('button', { name: /members\.memberDetails\.assign/i })).not.toBeInTheDocument()
      expect(editButton.querySelector('.i-ri-edit-line')).toBeInTheDocument()
      expect(editButton.querySelector('.i-ri-add-line')).not.toBeInTheDocument()
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

      expect(screen.getByText(/common\.members\.memberDetails\.assignedRole:/i)).toBeInTheDocument()
      expect(screen.queryByText(/common\.members\.memberDetails\.assignedRoles/i)).not.toBeInTheDocument()
    })

    it('should render role loading state without assigned role chips or count', () => {
      vi.mocked(useRolesOfMember).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as unknown as ReturnType<typeof useRolesOfMember>)

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          onClose={vi.fn()}
          onAssignSubmit={vi.fn()}
        />,
      )

      expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /members\.memberDetails\.assign/i })).toBeInTheDocument()
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

      expect(screen.getByRole('button', { name: /Custom role/i })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Custom role/i }))

      expect(screen.queryByRole('button', { name: /common\.operation\.remove/i })).not.toBeInTheDocument()
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

      expect(screen.queryByRole('button', { name: /members\.memberDetails\.assign/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /members\.memberDetails\.removeRoleAria/i })).not.toBeInTheDocument()
    })

    it('should submit pending role changes only after save is clicked', async () => {
      const user = userEvent.setup()
      const handleAssignSubmit = vi.fn()

      vi.mocked(useRolesOfMember).mockReturnValue({
        data: {
          account_id: member.id,
          roles: [
            createRole({ id: 'role-1', name: 'Custom role' }),
            createRole({ id: 'role-2', name: 'Second role' }),
          ],
        },
      } as unknown as ReturnType<typeof useRolesOfMember>)

      render(
        <MemberDetailsModal
          member={member}
          canAssignRoles
          onClose={vi.fn()}
          onAssignSubmit={handleAssignSubmit}
        />,
      )

      await user.click(screen.getByRole('button', { name: /Custom role/i }))

      await user.click(screen.getByRole('button', { name: /common\.operation\.remove/i }))

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
      await user.click(screen.getByRole('checkbox', { name: /Second role/i }))
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
      await user.click(screen.getByRole('radio', { name: /Second role/i }))
      await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      expect(handleAssignSubmit).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'role-2', name: 'Second role' }),
      ])
    })
  })
})
