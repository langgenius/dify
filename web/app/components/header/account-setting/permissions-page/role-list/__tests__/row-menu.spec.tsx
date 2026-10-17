import type { ReactElement } from 'react'
import type { Role } from '@/models/access-control'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import RowMenu from '../row-menu'

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['workspace.role.manage'] as string[],
}))

const { mockCopyRole, mockDeleteRole, getMembersOfRole } = vi.hoisted(() => ({
  mockCopyRole: vi.fn(),
  mockDeleteRole: vi.fn(),
  getMembersOfRole: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.byRoleId.copy.post': mockCopyRole,
      'workspaces.current.rbac.roles.byRoleId.delete': mockDeleteRole,
      'workspaces.current.rbac.roles.byRoleId.members.get': getMembersOfRole,
    }),
  }
})

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { workspacePermissionKeys: mockWorkspacePermissionKeys.value })

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
  },
}))

const createRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_system_default',
  name: 'Owner',
  description: 'Workspace owner',
  is_builtin: true,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

const openMenu = async () => {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'common.operation.moreActions' })

  await user.click(trigger)

  const menus = screen.getAllByRole('menu')
  return {
    user,
    menu: menus[menus.length - 1]!,
  }
}

describe('RowMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCopyRole.mockResolvedValue(createRole())
    mockDeleteRole.mockResolvedValue({ result: 'success' })
    getMembersOfRole.mockResolvedValue({
      data: [],
      pagination: { total_count: 3, per_page: 9999, current_page: 1, total_pages: 1 },
    })
    mockWorkspacePermissionKeys.value = ['workspace.role.manage']
  })

  describe('Rendering', () => {
    it('should render view action for the owner system role', async () => {
      render(
        <RowMenu roleCategory="global_system_default" role={createRole({ role_tag: 'owner' })} />,
      )

      const { menu } = await openMenu()

      expect(
        within(menu).getByRole('menuitem', { name: 'common.operation.view' }),
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }),
      ).toBeInTheDocument()
      expect(
        within(menu).queryByRole('menuitem', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
      expect(
        within(menu).queryByRole('menuitem', { name: 'common.operation.delete' }),
      ).not.toBeInTheDocument()
    })

    it('should render view action for non-owner system roles', async () => {
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={createRole({ id: 'role-editor', name: 'Editor' })}
        />,
      )

      const { menu } = await openMenu()

      expect(
        within(menu).getByRole('menuitem', { name: 'common.operation.view' }),
      ).toBeInTheDocument()
      expect(
        within(menu).queryByRole('menuitem', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
    })

    it('should hide view action for custom roles', async () => {
      render(
        <RowMenu
          roleCategory="global_custom"
          role={createRole({
            id: 'role-custom',
            category: 'global_custom',
            name: 'Custom role',
            is_builtin: false,
          })}
        />,
      )

      const { menu } = await openMenu()

      expect(
        within(menu).queryByRole('menuitem', { name: 'common.operation.view' }),
      ).not.toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'common.operation.edit' }),
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }),
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'common.operation.delete' }),
      ).toBeInTheDocument()
    })

    it('should keep custom role management actions visible without manage permission', async () => {
      mockWorkspacePermissionKeys.value = []

      render(
        <RowMenu
          roleCategory="global_custom"
          role={createRole({
            id: 'role-custom',
            category: 'global_custom',
            name: 'Custom role',
            is_builtin: false,
          })}
        />,
      )

      const { menu } = await openMenu()

      expect(within(menu).getByRole('menuitem', { name: 'common.operation.edit' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(
        within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        within(menu).getByRole('menuitem', { name: 'common.operation.delete' }),
      ).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('User Interactions', () => {
    it('should call onView when clicking the owner view action', async () => {
      const onView = vi.fn()
      const role = createRole({ role_tag: 'owner' })
      render(<RowMenu roleCategory="global_system_default" role={role} onView={onView} />)

      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'common.operation.view' }))

      expect(onView).toHaveBeenCalledTimes(1)
      expect(onView).toHaveBeenCalledWith(role)
    })

    it('should ask before duplicating a system role and skipping member assignments', async () => {
      const role = createRole({ id: 'role-default-editor', name: 'Editor' })
      render(<RowMenu roleCategory="global_system_default" role={role} />)

      const { user, menu } = await openMenu()
      await user.click(
        within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }),
      )

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('permission.role.copyMembersTitle')
      expect(dialog).toHaveTextContent(
        'permission.role.copyMembersDescription:{"name":"Editor","count":3}',
      )
      expect(getMembersOfRole).toHaveBeenCalledWith({
        params: { role_id: role.id },
        query: { page: 1, limit: 9999 },
      })

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.skip' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(mockCopyRole).toHaveBeenCalledTimes(1)
      expect(mockCopyRole).toHaveBeenCalledWith({
        params: { role_id: role.id },
        body: { copy_member: false },
      })
    })

    it('should copy member assignments when confirming duplicate with copy', async () => {
      const role = createRole({
        id: 'role-custom',
        category: 'global_custom',
        name: 'Support',
        is_builtin: false,
      })
      render(<RowMenu roleCategory="global_custom" role={role} />)

      const { user, menu } = await openMenu()
      await user.click(
        within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }),
      )
      const dialog = await screen.findByRole('alertdialog')

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.copy' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(mockCopyRole).toHaveBeenCalledTimes(1)
      expect(mockCopyRole).toHaveBeenCalledWith({
        params: { role_id: role.id },
        body: { copy_member: true },
      })
    })

    it('should ignore role management actions without manage permission', async () => {
      mockWorkspacePermissionKeys.value = []
      const onEdit = vi.fn()
      const role = createRole({
        id: 'role-custom',
        category: 'global_custom',
        name: 'Custom role',
        is_builtin: false,
      })
      render(<RowMenu roleCategory="global_custom" role={role} onEdit={onEdit} />)

      const { menu } = await openMenu()

      await userEvent
        .setup()
        .click(within(menu).getByRole('menuitem', { name: 'common.operation.edit' }))
      await userEvent
        .setup()
        .click(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }))
      await userEvent
        .setup()
        .click(within(menu).getByRole('menuitem', { name: 'common.operation.delete' }))

      expect(onEdit).not.toHaveBeenCalled()
      expect(mockCopyRole).not.toHaveBeenCalled()
      expect(mockDeleteRole).not.toHaveBeenCalled()
    })
  })
})
