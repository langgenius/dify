import type { Role } from '@/models/access-control'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AssignRolesModal from '../index'

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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': async () => ({
        data: roles,
        pagination: { total_count: roles.length, per_page: 20, current_page: 1, total_pages: 1 },
      }),
    }),
  }
})

describe('AssignRolesModal', () => {
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
          await screen.findByRole(allowMultipleRoles ? 'checkbox' : 'radio', {
            name: /Second role/,
          }),
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

      await user.click(await screen.findByRole('checkbox', { name: /First role/i }))

      expect(confirmButton).toBeDisabled()
    })
  })
})
