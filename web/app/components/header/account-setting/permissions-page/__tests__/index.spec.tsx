import type { Role, RoleListResponse } from '@/models/access-control'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import PermissionsPage from '../index'

const { get, post, put, request } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/service/base', () => ({ get, post, put, del: vi.fn(), patch: vi.fn(), request }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn() } }))

const role: Role = {
  id: 'custom-role',
  tenant_id: 'workspace-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Custom manager',
  description: 'Can manage workspace members',
  is_builtin: false,
  permission_keys: ['workspace.member.manage'],
  role_tag: '',
}
const builtin: Role = {
  ...role,
  id: 'system-role',
  name: 'System reader',
  is_builtin: true,
  category: 'global_system_default',
}
const roleList: RoleListResponse = {
  data: [builtin, role],
  pagination: { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 },
}
const catalog = {
  groups: [
    {
      group_key: 'workspace_management',
      group_name: 'Workspace management',
      description: '',
      permissions: [{ key: 'workspace.member.manage', name: 'Manage members', description: '' }],
    },
  ],
}

function setup(canManage = true) {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: canManage ? ['workspace.role.manage'] : [],
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({ input: {} }),
    catalog,
  )
  const containerRef = { current: document.createElement('div') }
  return { ...render(<PermissionsPage containerRef={containerRef} />, { wrapper }), queryClient }
}
async function openRow(mode: 'edit' | 'view') {
  await screen.findByText(role.name)
  await userEvent.click(
    screen.getAllByRole('button', { name: 'common.operation.moreActions' })[
      mode === 'edit' ? 1 : 0
    ]!,
  )
  await userEvent.click(screen.getByRole('menuitem', { name: `common.operation.${mode}` }))
  return screen.getByRole('dialog', { name: `permission.role.modal.${mode}.title` })
}
beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue(roleList)
  post.mockResolvedValue(role)
  put.mockResolvedValue(role)
  request.mockImplementation(async () => Response.json(catalog))
})
it('keeps management actions gated while allowing system-role viewing', async () => {
  const user = userEvent.setup()
  setup(false)
  await screen.findByText(role.name)
  expect(screen.queryByRole('button', { name: 'permission.role.addRole' })).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.moreActions' })[1]!)
  expect(screen.getByRole('menuitem', { name: 'common.operation.edit' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.keyboard('{Escape}')
  const dialog = await openRow('view')
  expect(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }),
  ).toHaveValue(builtin.name)
  expect(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }),
  ).toBeDisabled()
  expect(
    within(dialog).queryByRole('button', { name: 'common.operation.confirm' }),
  ).not.toBeInTheDocument()
})
it('disables role creation until the original role query completes', async () => {
  let complete!: (value: RoleListResponse) => void
  get.mockReturnValue(
    new Promise<RoleListResponse>((resolve) => {
      complete = resolve
    }),
  )
  setup()
  expect(screen.getByRole('button', { name: 'permission.role.addRole' })).toBeDisabled()
  await act(async () => complete(roleList))
  await screen.findByText(role.name)
  expect(screen.getByRole('button', { name: 'permission.role.addRole' })).toBeEnabled()
})
it('submits trimmed create fields and closes before the request finishes', async () => {
  let complete!: (value: Role) => void
  post.mockReturnValue(
    new Promise<Role>((resolve) => {
      complete = resolve
    }),
  )
  const user = userEvent.setup()
  setup()
  await screen.findByText(role.name)
  await user.click(screen.getByRole('button', { name: 'permission.role.addRole' }))
  const dialog = screen.getByRole('dialog', { name: 'permission.role.modal.create.title' })
  await user.type(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }),
    '  Support role  ',
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.descriptionLabel' }),
    '  Helps members  ',
  )
  await user.click(within(dialog).getByRole('checkbox', { name: /workspace.member.manage/ }))
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(post).toHaveBeenCalledExactlyOnceWith('/workspaces/current/rbac/roles', {
    body: {
      name: 'Support role',
      description: 'Helps members',
      permission_keys: ['workspace.member.manage'],
    },
  })
  expect(toast.success).not.toHaveBeenCalled()
  await act(async () => complete(role))
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('permission.role.created'))
  expect(get).toHaveBeenCalledTimes(2)
})
it('submits the selected role id and closes before an update finishes', async () => {
  let complete!: (value: Role) => void
  put.mockReturnValue(
    new Promise<Role>((resolve) => {
      complete = resolve
    }),
  )
  const user = userEvent.setup()
  setup()
  const dialog = await openRow('edit')
  const description = within(dialog).getByRole('textbox', {
    name: 'permission.role.modal.descriptionLabel',
  })
  await user.clear(description)
  await user.type(description, '  Updated role  ')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(put).toHaveBeenCalledExactlyOnceWith('/workspaces/current/rbac/roles/custom-role', {
    body: {
      id: role.id,
      name: role.name,
      description: 'Updated role',
      permission_keys: role.permission_keys,
    },
  })
  expect(toast.success).not.toHaveBeenCalled()
  await act(async () => complete(role))
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('permission.role.updated'))
})
it('reopens the selected role from its current source and releases the catalog query on close', async () => {
  const user = userEvent.setup()
  const { queryClient } = setup()
  let dialog = await openRow('edit')
  await user.clear(within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }))
  await user.type(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }),
    'Unsaved role',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(dialog.isConnected).toBe(false))
  const catalogKey = consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({
    input: {},
  })
  await act(async () => queryClient.invalidateQueries({ queryKey: catalogKey }))
  expect(request).not.toHaveBeenCalled()
  dialog = await openRow('view')
  expect(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }),
  ).toHaveValue(builtin.name)
  await user.click(within(dialog).getAllByRole('button', { name: 'common.operation.close' })[0]!)
  await waitFor(() => expect(dialog.isConnected).toBe(false))
  dialog = await openRow('edit')
  expect(
    within(dialog).getByRole('textbox', { name: 'permission.role.modal.nameLabel' }),
  ).toHaveValue(role.name)
})
