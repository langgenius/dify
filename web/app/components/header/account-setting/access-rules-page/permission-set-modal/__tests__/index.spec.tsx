import type { PermissionGroup } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PermissionSetModal from '../index'

const mockCatalogs = vi.hoisted(() => ({
  app: {
    groups: [] as PermissionGroup[],
  },
  dataset: {
    groups: [] as PermissionGroup[],
  },
}))

vi.mock('@/service/access-control/use-permission-catalog', () => ({
  useAppPermissionCatalog: () => ({
    data: { groups: mockCatalogs.app.groups },
  }),
  useDatasetPermissionCatalog: () => ({
    data: { groups: mockCatalogs.dataset.groups },
  }),
}))

const createPermissionGroup = (overrides: Partial<PermissionGroup> = {}): PermissionGroup => ({
  group_key: 'app_management',
  group_name: 'App management',
  description: '',
  permissions: [
    {
      key: 'app.acl.edit',
      name: 'Edit app',
      description: '',
    },
    {
      key: 'app.acl.publish',
      name: 'Publish app',
      description: '',
    },
  ],
  ...overrides,
})

describe('PermissionSetModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCatalogs.app.groups = [createPermissionGroup()]
    mockCatalogs.dataset.groups = [
      createPermissionGroup({
        group_key: 'dataset_management',
        group_name: 'Dataset management',
        permissions: [
          {
            key: 'dataset.acl.edit',
            name: 'Edit dataset',
            description: '',
          },
        ],
      }),
    ]
  })

  // Rendering keeps the form fields and permission picker available inside the modal.
  describe('Rendering', () => {
    it('should render create mode with app permission catalog', () => {
      render(
        <PermissionSetModal
          open
          mode="create"
          resourceType="app"
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByText('permission.permissionSet.modal.create.app.title')).toBeInTheDocument()
      expect(screen.getByLabelText(/permission\.permissionSet\.nameLabel/)).toBeInTheDocument()
      expect(screen.getByLabelText('permission.permissionSet.descriptionLabel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /App management/ })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(/app\.acl\.edit/)).toBeInTheDocument()
    })

    it('should render dataset permission catalog when resource type is dataset', () => {
      render(
        <PermissionSetModal
          open
          mode="create"
          resourceType="dataset"
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByText('permission.permissionSet.modal.create.dataset.title')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Dataset management/ })).toBeInTheDocument()
      expect(screen.getByText(/dataset\.acl\.edit/)).toBeInTheDocument()
    })
  })

  // Form submission trims text fields and sends the selected permission keys.
  describe('User Interactions', () => {
    it('should submit trimmed values and selected permissions when confirming create mode', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      const handleSubmit = vi.fn()

      render(
        <PermissionSetModal
          open
          mode="create"
          resourceType="app"
          onClose={handleClose}
          onSubmit={handleSubmit}
        />,
      )

      await user.type(screen.getByLabelText(/permission\.permissionSet\.nameLabel/), '  Custom app rule  ')
      await user.type(screen.getByLabelText('permission.permissionSet.descriptionLabel'), '  Can edit apps  ')
      await user.click(screen.getByText(/app\.acl\.publish/))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledTimes(1)
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Custom app rule',
        description: 'Can edit apps',
        permissionKeys: ['app.acl.publish'],
      })
      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })

  // View mode is read-only and uses close-only footer actions.
  describe('Read-only Mode', () => {
    it('should disable editing and hide confirm action in view mode', () => {
      render(
        <PermissionSetModal
          open
          mode="view"
          resourceType="app"
          initialValues={{
            name: 'Viewer',
            description: 'Read only rule',
            permissionKeys: ['app.acl.edit'],
          }}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByLabelText(/permission\.permissionSet\.nameLabel/)).toBeDisabled()
      expect(screen.getByLabelText('permission.permissionSet.descriptionLabel')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'common.operation.confirm' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'permission.permissionList.clearAll' })).not.toBeInTheDocument()
    })
  })
})
