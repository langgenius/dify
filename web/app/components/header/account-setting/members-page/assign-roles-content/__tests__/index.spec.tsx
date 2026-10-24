import type { Role } from '@/models/access-control'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AssignRolesContent from '../index'

function TestDialog({
  onClose,
  onSubmit,
  selectedRoles,
  allowMultipleRoles,
}: {
  onClose: () => void
  onSubmit: (roles: Role[]) => void
  selectedRoles: Role[]
  allowMultipleRoles?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent initialFocus={inputRef}>
        <AssignRolesContent
          searchInputRef={inputRef}
          selectedRoles={selectedRoles}
          allowMultipleRoles={allowMultipleRoles}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

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

describe('AssignRolesContent', () => {
  describe('Role selection', () => {
    it.each([false, true])(
      'submits the selected roles with multiple=%s',
      async (allowMultipleRoles) => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        const onClose = vi.fn()
        render(
          <TestDialog
            selectedRoles={[roles[0]!]}
            allowMultipleRoles={allowMultipleRoles}
            onClose={onClose}
            onSubmit={onSubmit}
          />,
        )
        await user.click(
          await screen.findByRole('option', {
            name: /Second role/,
          }),
        )
        expect(screen.getByRole('option', { name: /First role/ })).toHaveAttribute(
          'aria-selected',
          String(allowMultipleRoles),
        )
        await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/ }))
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith(allowMultipleRoles ? roles : [roles[1]])
      },
    )

    it('should disable confirm when the last selected role is unchecked', async () => {
      const user = userEvent.setup()

      render(<TestDialog selectedRoles={[roles[0]!]} onClose={vi.fn()} onSubmit={vi.fn()} />)

      const confirmButton = screen.getByRole('button', { name: /common\.operation\.confirm/i })

      expect(confirmButton).toBeEnabled()

      await user.click(await screen.findByRole('option', { name: /First role/i }))

      expect(confirmButton).toBeDisabled()
    })
  })
})
