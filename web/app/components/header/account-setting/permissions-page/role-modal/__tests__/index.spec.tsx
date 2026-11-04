import type { PermissionCatalogResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { Role } from '@/models/access-control'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'
import RoleModal from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'permission.group.workspace_management': 'Translated workspace permissions',
    'permissionKeys.workspace.member.manage': 'Manage workspace members',
  })
})

const workspacePermissionCatalog = {
  groups: [
    {
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
    },
  ],
} satisfies PermissionCatalogResponse

const renderModal = (modal: ReactNode) => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({ input: {} }),
    workspacePermissionCatalog,
  )

  return render(<QueryClientProvider client={queryClient}>{modal}</QueryClientProvider>)
}

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
  })

  describe('User Interactions', () => {
    it('should submit trimmed role fields and selected permission keys', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      const handleSubmit = vi.fn()

      renderModal(<RoleModal open mode="create" onClose={handleClose} onSubmit={handleSubmit} />)

      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
      await user.type(screen.getByLabelText('permission.role.modal.nameLabel'), '  Support role  ')
      await user.type(
        screen.getByLabelText('permission.role.modal.descriptionLabel'),
        '  Helps members  ',
      )
      await user.click(screen.getByText('Manage workspace members'))
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

      renderModal(
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

      expect(screen.getByLabelText('permission.role.modal.nameLabel')).toHaveValue('Operator')
      expect(
        screen.getByRole('button', { name: /Translated workspace permissions/ }),
      ).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Manage workspace members')).toBeInTheDocument()
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

  describe('Read-only Mode', () => {
    it('should render role details as read-only in view mode', () => {
      renderModal(
        <RoleModal open mode="view" role={createRole()} onClose={vi.fn()} onSubmit={vi.fn()} />,
      )

      expect(screen.getByLabelText('permission.role.modal.nameLabel')).toBeDisabled()
      expect(screen.getByLabelText('permission.role.modal.descriptionLabel')).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'common.operation.confirm' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'permission.permissionList.clearAll' }),
      ).not.toBeInTheDocument()
    })
  })
})
