import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useRolesOfMember } from '@/service/access-control/use-member-roles'
import MemberDetailsModal from '../index'

vi.mock('@/service/access-control/use-member-roles')

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
    { id: 'role-1', name: 'Custom role' },
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
    } as unknown as ReturnType<typeof useRolesOfMember>)
  })

  describe('Role actions', () => {
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

    it('should show role action menu and remove role when role assignment is allowed', async () => {
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

      await user.click(screen.getByRole('menuitem', { name: /common\.operation\.remove/i }))

      expect(handleAssignSubmit).toHaveBeenCalledWith(['role-2'])
    })
  })
})
