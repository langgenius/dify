import type { Role } from '@/models/access-control'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RowMenu from '../row-menu'

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['workspace.role.manage'] as string[],
}))

const mockCopyRole = vi.hoisted(() => vi.fn((_variables, options?: { onSuccess?: () => void }) => {
  options?.onSuccess?.()
}))
const mockDeleteRole = vi.hoisted(() => vi.fn())
const membersOfRoleQueryMock = vi.hoisted(() => {
  const response = {
    data: [],
    pagination: {
      total_count: 3,
      per_page: 1,
      current_page: 1,
      total_pages: 3,
    },
  }

  return {
    useGetMembersOfRole: vi.fn(() => ({
      data: response,
      isPending: false,
    })),
  }
})

vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (state: { workspacePermissionKeys: string[] }) => T): T => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/service/access-control/use-workspace-roles', () => ({
  useCopyWorkspaceRole: () => ({
    mutate: mockCopyRole,
    isPending: false,
  }),
  useDeleteWorkspaceRole: () => ({
    mutateAsync: mockDeleteRole,
    isPending: false,
  }),
  useGetMembersOfRole: membersOfRoleQueryMock.useGetMembersOfRole,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
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
  await user.click(screen.getByRole('button', { name: 'common.operation.moreActions' }))
  const menus = screen.getAllByRole('menu')
  return {
    user,
    menu: menus[menus.length - 1]!,
  }
}

describe('RowMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.querySelectorAll('[role="menu"], [role="menuitem"]').forEach(element => element.remove())
    mockWorkspacePermissionKeys.value = ['workspace.role.manage']
  })

  afterEach(() => {
    document.body.querySelectorAll('[role="menu"], [role="menuitem"]').forEach(element => element.remove())
  })

  describe('Rendering', () => {
    it('should render view action for the owner system role', async () => {
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={createRole({ role_tag: 'owner' })}
        />,
      )

      const { menu } = await openMenu()

      expect(within(menu).getByRole('menuitem', { name: 'common.operation.view' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' })).toBeInTheDocument()
      expect(within(menu).queryByRole('menuitem', { name: 'common.operation.edit' })).not.toBeInTheDocument()
      expect(within(menu).queryByRole('menuitem', { name: 'common.operation.delete' })).not.toBeInTheDocument()
    })

    it('should render view action for non-owner system roles', async () => {
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={createRole({ id: 'role-editor', name: 'Editor' })}
        />,
      )

      const { menu } = await openMenu()

      expect(within(menu).getByRole('menuitem', { name: 'common.operation.view' })).toBeInTheDocument()
      expect(within(menu).queryByRole('menuitem', { name: 'common.operation.edit' })).not.toBeInTheDocument()
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

      expect(within(menu).queryByRole('menuitem', { name: 'common.operation.view' })).not.toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'common.operation.edit' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'common.operation.delete' })).toBeInTheDocument()
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

      expect(within(menu).getByRole('menuitem', { name: 'common.operation.edit' })).toHaveAttribute('aria-disabled', 'true')
      expect(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' })).toHaveAttribute('aria-disabled', 'true')
      expect(within(menu).getByRole('menuitem', { name: 'common.operation.delete' })).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('User Interactions', () => {
    it('should call onView when clicking the owner view action', async () => {
      const onView = vi.fn()
      const role = createRole({ role_tag: 'owner' })
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={role}
          onView={onView}
        />,
      )

      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'common.operation.view' }))

      expect(onView).toHaveBeenCalledTimes(1)
      expect(onView).toHaveBeenCalledWith(role)
    })

    it('should ask before duplicating a system role and skipping member assignments', async () => {
      const role = createRole({ id: 'role-default-editor', name: 'Editor' })
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={role}
        />,
      )

      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }))

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveTextContent('permission.role.copyMembersTitle')
      expect(dialog).toHaveTextContent('permission.role.copyMembersDescription:{"name":"Editor","count":3}')
      expect(membersOfRoleQueryMock.useGetMembersOfRole).toHaveBeenCalledWith({
        roleId: role.id,
        page: 1,
        limit: 9999,
      })

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.skip' }))

      expect(mockCopyRole).toHaveBeenCalledTimes(1)
      expect(mockCopyRole).toHaveBeenCalledWith({
        roleId: role.id,
        copy_member: false,
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
      }))
    })

    it('should copy member assignments when confirming duplicate with copy', async () => {
      const role = createRole({ id: 'role-custom', category: 'global_custom', name: 'Support', is_builtin: false })
      render(
        <RowMenu
          roleCategory="global_custom"
          role={role}
        />,
      )

      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }))
      const dialog = screen.getByRole('alertdialog')

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.copy' }))

      expect(mockCopyRole).toHaveBeenCalledTimes(1)
      expect(mockCopyRole).toHaveBeenCalledWith({
        roleId: role.id,
        copy_member: true,
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
      }))
    })

    it('should close the copy member assignments dialog when clicking the backdrop', async () => {
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={createRole({ id: 'role-default-editor', name: 'Editor' })}
        />,
      )

      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }))

      expect(screen.getByRole('alertdialog')).toBeInTheDocument()

      const backdrop = document.body.querySelector('.bg-background-overlay')
      expect(backdrop).toBeInTheDocument()
      fireEvent.click(backdrop!)

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
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
      render(
        <RowMenu
          roleCategory="global_custom"
          role={role}
          onEdit={onEdit}
        />,
      )

      const { menu } = await openMenu()

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'common.operation.edit' }))
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'permission.common.duplicateAction' }))
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'common.operation.delete' }))

      expect(onEdit).not.toHaveBeenCalled()
      expect(mockCopyRole).not.toHaveBeenCalled()
      expect(mockDeleteRole).not.toHaveBeenCalled()
    })
  })
})
