import type { PermissionGroup, Role } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RoleModal from '../index'

const mockWorkspacePermissionCatalog = vi.hoisted(() => ({
  groups: [] as PermissionGroup[],
}))

vi.mock('@/service/access-control/use-permission-catalog', () => ({
  useWorkspacePermissionCatalog: () => ({
    data: { groups: mockWorkspacePermissionCatalog.groups },
  }),
}))

const createPermissionGroup = (overrides: Partial<PermissionGroup> = {}): PermissionGroup => ({
  group_key: 'workspace_management',
  group_name: 'Workspace management',
  description: '',
  permissions: [
    {
      key: 'workspace.member.manage',
      name: 'Manage members',
      description: '',
    },
  ],
  ...overrides,
})

const createRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Operator',
  description: 'Can operate workspace',
  is_builtin: false,
  permission_keys: ['workspace.member.manage'],
  role_tag: '',
  ...overrides,
})

describe('RoleModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionCatalog.groups = [createPermissionGroup()]
  })

  // Rendering keeps role fields and workspace permissions in one modal form.
  describe('Rendering', () => {
    it('should render edit mode with role values and selected permissions', () => {
      render(
        <RoleModal
          open
          mode="edit"
          role={createRole()}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByText('permission.role.modal.edit.title')).toBeInTheDocument()
      expect(screen.getByLabelText('permission.role.modal.nameLabel')).toHaveValue('Operator')
      expect(screen.getByLabelText('permission.role.modal.descriptionLabel')).toHaveValue('Can operate workspace')
      expect(screen.getByRole('button', { name: /Workspace management/ })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(/workspace\.member\.manage/)).toBeInTheDocument()
    })

    it('should disable confirm action when role name is empty', () => {
      render(
        <RoleModal
          open
          mode="create"
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
    })
  })

  // Submitting creates the payload expected by role create/update mutations.
  describe('User Interactions', () => {
    it('should submit trimmed role fields and selected permission keys', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      const handleSubmit = vi.fn()

      render(
        <RoleModal
          open
          mode="create"
          onClose={handleClose}
          onSubmit={handleSubmit}
        />,
      )

      await user.type(screen.getByLabelText('permission.role.modal.nameLabel'), '  Support role  ')
      await user.type(screen.getByLabelText('permission.role.modal.descriptionLabel'), '  Helps members  ')
      await user.click(screen.getByText(/workspace\.member\.manage/))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledTimes(1)
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Support role',
        description: 'Helps members',
        permissionKeys: ['workspace.member.manage'],
      })
      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should submit an updated role description when editing an existing role', async () => {
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      render(
        <RoleModal
          open
          mode="edit"
          role={createRole({
            description: 'Original description',
            permission_keys: ['workspace.member.manage'],
          })}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
        />,
      )

      const descriptionInput = screen.getByLabelText('permission.role.modal.descriptionLabel')
      await user.clear(descriptionInput)
      await user.type(descriptionInput, '  Updated role description  ')
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledTimes(1)
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Operator',
        description: 'Updated role description',
        permissionKeys: ['workspace.member.manage'],
      })
    })
  })

  // View mode preserves the permission display but blocks edits and confirmation.
  describe('Read-only Mode', () => {
    it('should render role details as read-only in view mode', () => {
      render(
        <RoleModal
          open
          mode="view"
          role={createRole()}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('permission.role.modal.nameLabel')).toBeDisabled()
      expect(screen.getByLabelText('permission.role.modal.descriptionLabel')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'common.operation.confirm' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'permission.permissionList.clearAll' })).not.toBeInTheDocument()
    })
  })
})
