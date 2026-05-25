import type { Role } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RowMenu from '../row-menu'

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['workspace.role.manage'] as string[],
}))

const mockCopyRole = vi.hoisted(() => vi.fn())
const mockDeleteRole = vi.hoisted(() => vi.fn())

vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (state: { workspacePermissionKeys: string[] }) => T): T => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }),
}))

vi.mock('@/service/access-control/use-workspace-roles', () => ({
  useCopyWorkspaceRole: () => ({
    mutateAsync: mockCopyRole,
  }),
  useDeleteWorkspaceRole: () => ({
    mutateAsync: mockDeleteRole,
    isPending: false,
  }),
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
  return user
}

describe('RowMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['workspace.role.manage']
  })

  describe('Rendering', () => {
    it('should render view action for the owner system role', async () => {
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={createRole({ role_tag: 'owner' })}
        />,
      )

      await openMenu()

      expect(screen.getByRole('menuitem', { name: 'common.operation.view' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'common.operation.edit' })).not.toBeInTheDocument()
    })

    it('should hide view action for non-owner system roles', async () => {
      render(
        <RowMenu
          roleCategory="global_system_default"
          role={createRole({ id: 'role-editor', name: 'Editor' })}
        />,
      )

      await openMenu()

      expect(screen.queryByRole('menuitem', { name: 'common.operation.view' })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'common.operation.edit' })).toBeInTheDocument()
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

      await openMenu()

      expect(screen.queryByRole('menuitem', { name: 'common.operation.view' })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'common.operation.edit' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'common.operation.duplicate' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'common.operation.delete' })).toBeInTheDocument()
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

      const user = await openMenu()
      await user.click(screen.getByRole('menuitem', { name: 'common.operation.view' }))

      expect(onView).toHaveBeenCalledTimes(1)
      expect(onView).toHaveBeenCalledWith(role)
    })
  })
})
