import type { Role } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssignRolesModal from '../index'

const { mockWorkspaceRoleListHook } = vi.hoisted(() => ({
  mockWorkspaceRoleListHook: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.rbac.roles.get': () => mockWorkspaceRoleListHook(),
  })
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

describe('AssignRolesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  describe('Role selection', () => {
    it.each([false, true])(
      'submits the selected roles with multiple=%s and closes',
      async (allowMultipleRoles) => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        const onClose = vi.fn()
        render(
          <AssignRolesModal
            selectedRoles={[roles[0]!]}
            allowMultipleRoles={allowMultipleRoles}
            onClose={onClose}
            onSubmit={onSubmit}
          />,
        )
        await user.click(
          screen.getByRole(allowMultipleRoles ? 'checkbox' : 'radio', { name: /Second role/ }),
        )
        expect(
          screen.getByRole(allowMultipleRoles ? 'checkbox' : 'radio', { name: /First role/ }),
        ).toHaveAttribute('aria-checked', String(allowMultipleRoles))
        await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/ }))
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith(allowMultipleRoles ? roles : [roles[1]])
        expect(onClose).toHaveBeenCalledTimes(1)
      },
    )

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
