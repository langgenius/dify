import type { Role } from '@/models/access-control'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { AssignRolesModal } from '../index'

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
          open
          selectedRoles={[roles[0]!]}
          allowMultipleRoles={false}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(
        screen.queryByText(/workspaceMembers\.members\.assignRolesModal\.selectedCount/i),
      ).not.toBeInTheDocument()
    })

    it('should show single-role description when multiple roles are disabled', () => {
      render(
        <AssignRolesModal
          open
          selectedRoles={[roles[0]!]}
          allowMultipleRoles={false}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(
        screen.getByText(/workspaceMembers\.members\.assignRolesModal\.singleDescription/i),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/workspaceMembers\.members\.assignRolesModal\.description/i),
      ).not.toBeInTheDocument()
    })

    it('should disable confirm when the last selected role is unchecked', async () => {
      const user = userEvent.setup()

      render(
        <AssignRolesModal
          open
          selectedRoles={[roles[0]!]}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      const confirmButton = screen.getByRole('button', { name: /common\.operation\.confirm/i })

      expect(confirmButton).toBeEnabled()

      await user.click(screen.getByRole('checkbox', { name: /First role/i }))

      expect(confirmButton).toBeDisabled()
    })
  })
  describe('Dialog sessions', () => {
    it('keeps search Enter local and confirms without waiting for the callback', async () => {
      const user = userEvent.setup()
      let finishSubmit: () => void = () => {}
      const onSubmit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSubmit = resolve
          }),
      )
      const onOpenChange = vi.fn()
      render(
        <AssignRolesModal
          open
          selectedRoles={[roles[0]!]}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />,
      )

      await user.click(screen.getByRole('checkbox', { name: /Second role/i }))
      await user.click(screen.getByRole('searchbox', { name: /role.searchPlaceholder/i }))
      await user.keyboard('{Enter}')
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(roles)
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      finishSubmit()
    })

    it('discards canceled selections and search when the next session opens', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      const onOpenChange = vi.fn()
      const { rerender } = render(
        <AssignRolesModal
          open
          selectedRoles={[roles[0]!]}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />,
      )

      await user.click(screen.getByRole('checkbox', { name: /Second role/i }))
      await user.type(screen.getByRole('searchbox', { name: /role.searchPlaceholder/i }), 'Second')
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
      rerender(
        <AssignRolesModal
          open={false}
          selectedRoles={[roles[0]!]}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />,
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      rerender(
        <AssignRolesModal
          open
          selectedRoles={[roles[1]!]}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />,
      )

      expect(screen.getByRole('searchbox', { name: /role.searchPlaceholder/i })).toHaveValue('')
      expect(screen.getByRole('checkbox', { name: /First role/i })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: /Second role/i })).toBeChecked()
    })
  })
})
