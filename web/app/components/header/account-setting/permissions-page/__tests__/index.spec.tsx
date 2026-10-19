import type { Role } from '@/models/access-control'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import PermissionsPage from '../index'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': (input) => mocks.list(input),
      'workspaces.current.rbac.roles.post': (input) => mocks.create(input),
      'workspaces.current.rbac.roles.byRoleId.put': (input) => mocks.update(input),
      'workspaces.current.rbac.rolePermissions.catalog.get': () => ({ groups: [] }),
    }),
  }
})
const role: Role = {
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Custom manager',
  description: 'Can manage workspace members',
  is_builtin: false,
  permission_keys: ['workspace.member.manage'],
  role_tag: '',
}
function setup(canManage = true) {
  render(<PermissionsPage containerRef={{ current: document.createElement('div') }} />, {
    workspacePermissionKeys: canManage ? ['workspace.role.manage'] : [],
  })
  return userEvent.setup()
}
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Custom manager')
  await user.click(screen.getByRole('button', { name: 'permission.role.addRole' }))
  await user.type(screen.getByLabelText('permission.role.modal.nameLabel'), 'New manager')
  await user.type(screen.getByLabelText('permission.role.modal.descriptionLabel'), 'Support team')
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue({
    data: [role],
    pagination: { current_page: 1, total_pages: 1, total_count: 1, per_page: 20 },
  })
  mocks.create.mockResolvedValue(role)
  mocks.update.mockResolvedValue(role)
})

it('blocks create and edit without role management permission', async () => {
  const user = setup(false)
  await screen.findByText('Custom manager')
  expect(screen.queryByRole('button', { name: 'permission.role.addRole' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.moreActions' }))
  const edit = await screen.findByRole('menuitem', { name: 'common.operation.edit' })
  expect(edit).toHaveAttribute('aria-disabled', 'true')
  await user.click(edit)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps the real role draft open and blocks duplicate submits until creation succeeds', async () => {
  const response = createDeferred<Role>()
  mocks.create.mockReturnValue(response.promise)
  const user = setup()
  await openCreate(user)
  const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
  await user.click(confirm)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(confirm).toBeDisabled()
  await user.click(confirm)
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    body: {
      name: 'New manager',
      description: 'Support team',
      permission_keys: [],
    },
  })
  await act(async () => response.resolve(role))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('retains a failed creation draft for retry', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Save failed'))
  const user = setup()
  await openCreate(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeEnabled(),
  )
  expect(screen.getByLabelText('permission.role.modal.nameLabel')).toHaveValue('New manager')
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(mocks.create).toHaveBeenCalledTimes(2)
})

it('opens the selected role and saves edited fields with its existing permissions', async () => {
  const user = setup()
  await screen.findByText('Custom manager')
  await user.click(screen.getByRole('button', { name: 'common.operation.moreActions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'common.operation.edit' }))
  const name = screen.getByLabelText('permission.role.modal.nameLabel')
  expect(name).toHaveValue('Custom manager')
  await user.clear(name)
  await user.type(name, 'Updated manager')
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(mocks.update).toHaveBeenCalledWith({
    params: { role_id: 'role-1' },
    body: {
      name: 'Updated manager',
      description: role.description,
      permission_keys: role.permission_keys,
    },
  })
})
