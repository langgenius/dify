import type { Role } from '@/models/access-control'
import type { consoleClient } from '@/service/console'
import { userEvent } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { builtinRole, customRole, renderRolePage, rolePage } from './role-page-fixture'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.get>(),
  create: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.post>(),
  update: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.put>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': api.list,
      'workspaces.current.rbac.roles.post': api.create,
      'workspaces.current.rbac.roles.byRoleId.put': api.update,
    }),
  }
})
let roles: Role[]
beforeEach(() => {
  roles = [customRole]
  api.list.mockReset().mockImplementation(async () => rolePage(roles))
  api.create.mockReset().mockImplementation(async ({ body }) => {
    const saved = { ...customRole, ...body, id: 'created-role' }
    roles = [...roles, saved]
    return saved
  })
  api.update.mockReset().mockImplementation(async ({ params, body }) => {
    const saved = { ...customRole, ...body, id: params.role_id }
    roles = roles.map((role) => (role.id === saved.id ? saved : role))
    return saved
  })
})
async function setup(canManage = true) {
  const view = await renderRolePage(canManage)
  onTestFinished(() => view.queryClient.clear())
  return view.screen
}
async function openCreate(screen: Awaited<ReturnType<typeof setup>>) {
  await screen.getByRole('button', { name: 'permission.role.addRole' }).click()
  const dialog = screen.getByRole('dialog')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.confirm' }))
    .toBeDisabled()
  await dialog
    .getByRole('textbox', { name: 'permission.role.modal.nameLabel' })
    .fill('  New manager  ')
  await dialog
    .getByRole('textbox', { name: 'permission.role.modal.descriptionLabel' })
    .fill('  Support team  ')
  return dialog
}

it('keeps management actions disabled for members without role management permission', async () => {
  const screen = await setup(false)
  await expect.element(screen.getByText('Custom manager')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'permission.role.addRole' }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
  for (const name of [
    'common.operation.edit',
    'permission.common.duplicateAction',
    'common.operation.delete',
  ]) {
    await expect
      .element(screen.getByRole('menuitem', { name }))
      .toHaveAttribute('aria-disabled', 'true')
  }
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('keeps the selected built-in role read-only across grouped rows', async () => {
  roles = [builtinRole, customRole]
  const screen = await setup()
  await expect.element(screen.getByText('Custom manager')).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).nth(0).click()
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
    .not.toBeInTheDocument()
  await screen.getByRole('menuitem', { name: 'common.operation.view' }).click()
  const dialog = screen.getByRole('dialog')
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.role.modal.nameLabel' }))
    .toHaveValue('Owner')
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.role.modal.nameLabel' }))
    .toBeDisabled()
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.role.modal.descriptionLabel' }))
    .toBeDisabled()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.confirm' }))
    .not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('button', { name: 'permission.permissionList.clearAll' }))
    .not.toBeInTheDocument()
})

it('preserves trimmed role fields and permission selection across a pending failure, then refreshes the list on retry', async () => {
  const pending = createDeferred<void>()
  const create = api.create.getMockImplementation()!
  api.create.mockImplementationOnce(async (...args) => {
    await pending.promise
    return create(...args)
  })
  const screen = await setup()
  const dialog = await openCreate(screen)
  await dialog.getByRole('checkbox', { name: /permissionKeys.workspace.member.manage/ }).click()
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await expect.element(dialog).toBeVisible()
  expect(api.create).toHaveBeenCalledExactlyOnceWith({
    body: {
      name: 'New manager',
      description: 'Support team',
      permission_keys: ['workspace.member.manage'],
    },
  })
  pending.reject(new Error('Save failed'))
  await expect.element(confirm).toBeEnabled()
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.role.modal.nameLabel' }))
    .toHaveValue('  New manager  ')
  await expect
    .element(dialog.getByRole('checkbox', { name: /permissionKeys.workspace.member.manage/ }))
    .toBeChecked()
  await confirm.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('New manager', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Support team', { exact: true })).toBeVisible()
})

it('updates the selected role and preserves its existing permission selection', async () => {
  const screen = await setup()
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog')
  await expect
    .element(dialog.getByRole('checkbox', { name: /permissionKeys.workspace.member.manage/ }))
    .toBeChecked()
  await expect
    .element(dialog.getByRole('button', { name: /permission.group.workspace_management/ }))
    .toHaveAttribute('aria-expanded', 'true')
  await dialog
    .getByRole('textbox', { name: 'permission.role.modal.nameLabel' })
    .fill('Updated manager')
  await dialog
    .getByRole('textbox', { name: 'permission.role.modal.descriptionLabel' })
    .fill('  Updated description  ')
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('Updated manager', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Updated description', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Custom manager', { exact: true })).not.toBeInTheDocument()
  expect(api.update).toHaveBeenCalledWith({
    params: { role_id: customRole.id },
    body: {
      name: 'Updated manager',
      description: 'Updated description',
      permission_keys: customRole.permission_keys,
    },
  })
})
