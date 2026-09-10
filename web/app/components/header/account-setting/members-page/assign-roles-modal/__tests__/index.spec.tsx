import type { Role } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import AssignRolesModal from '../index'

vi.mock('@/service/access-control/use-workspace-roles')

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

describe('AssignRolesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
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
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)
  })

  describe('Role selection', () => {
    it('should hide selected count when multiple roles are disabled', () => {
      render(
        <AssignRolesModal
          selectedRoles={[roles[0]!]}
          allowMultipleRoles={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(
        screen.queryByText(/common\.members\.assignRolesModal\.selectedCount/i),
      ).not.toBeInTheDocument()
    })

    it('should show single-role description when multiple roles are disabled', () => {
      render(
        <AssignRolesModal
          selectedRoles={[roles[0]!]}
          allowMultipleRoles={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(
        screen.getByText(/common\.members\.assignRolesModal\.singleDescription/i),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/common\.members\.assignRolesModal\.description/i),
      ).not.toBeInTheDocument()
    })

    it('should disable confirm when the last selected role is unchecked', async () => {
      const user = userEvent.setup()

      render(<AssignRolesModal selectedRoles={[roles[0]!]} onClose={vi.fn()} onSubmit={vi.fn()} />)

      const confirmButton = screen.getByRole('button', { name: /common\.operation\.confirm/i })

      expect(confirmButton).toBeEnabled()

      await user.click(screen.getByRole('checkbox', { name: /First role/i }))

      expect(confirmButton).toBeDisabled()
    })
  })
})
