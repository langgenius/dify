import type { PermissionCatalogResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/client'
import { createTestQueryClient } from '@/test/query-client'
import PermissionSetModal from '../index'

const expectedAppACLPermissionKeys = [
  'app.acl.view_layout',
  'app.acl.test_and_run',
  'app.acl.edit',
  'app.acl.import_export_dsl',
  'app.acl.delete',
  'app.acl.release_and_version',
  'app.acl.monitor',
  'app.acl.tracing_config',
  'app.acl.log_and_annotation',
  'app.acl.access_config',
]

const getPermissionKeyMatcher = (permissionKey: string) =>
  new RegExp(permissionKey.replaceAll('.', '\\.'))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'permission.group.app_acl': 'Translated app permissions',
    'permission.group.dataset_acl': 'Translated dataset permissions',
  })
})

const appPermissionCatalog = {
  groups: [
    {
      group_key: 'app_management',
      group_name: 'App management',
      description: '',
      permissions: expectedAppACLPermissionKeys.map((permissionKey) => ({
        key: permissionKey,
        name: permissionKey,
        description: '',
      })),
    },
  ],
} satisfies PermissionCatalogResponse

const datasetPermissionCatalog = {
  groups: [
    {
      group_key: 'dataset_management',
      group_name: 'Dataset management',
      description: '',
      permissions: [
        {
          key: 'dataset.acl.edit',
          name: 'Edit dataset',
          description: '',
        },
      ],
    },
  ],
} satisfies PermissionCatalogResponse

const renderModal = (modal: ReactNode) => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.app.get.queryKey({ input: {} }),
    appPermissionCatalog,
  )
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.dataset.get.queryKey({
      input: {},
    }),
    datasetPermissionCatalog,
  )

  return render(<QueryClientProvider client={queryClient}>{modal}</QueryClientProvider>)
}

describe('PermissionSetModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering keeps the form fields and permission picker available inside the modal.
  describe('Rendering', () => {
    it('should render create mode with app permission catalog', () => {
      renderModal(
        <PermissionSetModal
          open
          mode="create"
          resourceType="app"
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(
        screen.getByText('permission.permissionSet.modal.create.app.title'),
      ).toBeInTheDocument()
      expect(screen.getByLabelText(/permission\.permissionSet\.nameLabel/)).toBeInTheDocument()
      expect(screen.getByLabelText('permission.permissionSet.descriptionLabel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Translated app permissions/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(screen.getByText(/app\.acl\.edit/)).toBeInTheDocument()
    })

    it('should render the complete app ACL permission catalog', async () => {
      renderModal(
        <PermissionSetModal
          open
          mode="create"
          resourceType="app"
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      for (const permissionKey of expectedAppACLPermissionKeys)
        expect(await screen.findByText(getPermissionKeyMatcher(permissionKey))).toBeInTheDocument()
    })

    it('should render dataset permission catalog when resource type is dataset', () => {
      renderModal(
        <PermissionSetModal
          open
          mode="create"
          resourceType="dataset"
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      expect(
        screen.getByText('permission.permissionSet.modal.create.dataset.title'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Translated dataset permissions/ }),
      ).toBeInTheDocument()
      expect(screen.getByText(/dataset\.acl\.edit/)).toBeInTheDocument()
    })
  })

  // Form submission trims text fields and sends the selected permission keys.
  describe('User Interactions', () => {
    it('should submit trimmed values and selected permissions when confirming create mode', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      const handleSubmit = vi.fn()

      renderModal(
        <PermissionSetModal
          open
          mode="create"
          resourceType="app"
          onClose={handleClose}
          onSubmit={handleSubmit}
        />,
      )

      await user.type(
        screen.getByLabelText(/permission\.permissionSet\.nameLabel/),
        '  Custom app rule  ',
      )
      await user.type(
        screen.getByLabelText('permission.permissionSet.descriptionLabel'),
        '  Can edit apps  ',
      )
      await user.click(screen.getByText(/app\.acl\.release_and_version/))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledTimes(1)
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Custom app rule',
        description: 'Can edit apps',
        permissionKeys: ['app.acl.release_and_version'],
      })
      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should submit an updated description when editing an existing permission set', async () => {
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderModal(
        <PermissionSetModal
          open
          mode="edit"
          resourceType="app"
          initialValues={{
            name: 'Existing app rule',
            description: 'Original description',
            permissionKeys: ['app.acl.edit'],
          }}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
        />,
      )

      const descriptionInput = screen.getByLabelText('permission.permissionSet.descriptionLabel')
      await user.clear(descriptionInput)
      await user.type(descriptionInput, '  Updated rule description  ')
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledTimes(1)
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Existing app rule',
        description: 'Updated rule description',
        permissionKeys: ['app.acl.edit'],
      })
    })
  })

  // View mode is read-only and uses close-only footer actions.
  describe('Read-only Mode', () => {
    it('should disable editing and hide confirm action in view mode', () => {
      renderModal(
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
      expect(
        screen.queryByRole('button', { name: 'common.operation.confirm' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'permission.permissionList.clearAll' }),
      ).not.toBeInTheDocument()
    })
  })
})
