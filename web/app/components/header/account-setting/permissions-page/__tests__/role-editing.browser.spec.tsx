import type { Role } from '@/models/access-control'
import type { consoleClient } from '@/service/console'
import { userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { builtinRole, customRole, renderRolePage, rolePage } from './role-page-fixture'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.get>(),
  create: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.post>(),
  update: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.put>(),
  remove: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.delete>(),
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
      'workspaces.current.rbac.roles.byRoleId.delete': api.remove,
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
  api.remove.mockReset()
})
async function setup(options?: Parameters<typeof renderRolePage>[0]) {
  const view = await renderRolePage(options)
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
  const screen = await setup({ canManage: false })
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

it('retains a failed role deletion for retry and closes before the list refresh finishes', async () => {
  const first = createDeferred<{ result: string }>()
  const retry = createDeferred<{ result: string }>()
  const refresh = createDeferred<ReturnType<typeof rolePage>>()
  api.remove.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
  const { screen, queryClient } = await renderRolePage()
  onTestFinished(() => queryClient.clear())

  const actions = screen.getByRole('button', { name: 'common.operation.moreActions' })
  await actions.click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'common.operation.delete' })
  await confirm.click()
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirm).toHaveFocus()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await userEvent.keyboard('{Enter}{Escape}')
  await expect.element(dialog).toBeVisible()
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({ params: { role_id: customRole.id } })

  first.reject(new Error('Delete failed'))
  await expect.element(confirm).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(api.remove).toHaveBeenCalledTimes(2)
  api.list.mockReturnValueOnce(refresh.promise)
  retry.resolve({ result: 'success' })

  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(customRole.name)).not.toBeInTheDocument()
  const addRole = screen.getByRole('button', { name: 'permission.role.addRole' })
  await expect.element(addRole).toHaveFocus()
  refresh.reject(new Error('List refresh failed'))
  const listKey = consoleQuery.workspaces.current.rbac.roles.get.key({ type: 'infinite' })
  await expect
    .poll(() => queryClient.getQueryCache().find({ queryKey: listKey, exact: false })?.state.status)
    .toBe('error')
  await expect.element(screen.getByText(customRole.name)).not.toBeInTheDocument()
  await expect.element(addRole).toHaveFocus()
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
  await dialog.getByRole('button', { name: 'permission.permissionList.selectAll' }).click()
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

it('preserves hidden IP policy grants when clearing the visible permissions of an Enterprise role', async () => {
  roles = [{ ...customRole, permission_keys: ['workspace.member.manage', 'ip_policy.view'] }]
  const screen = await setup()
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog')
  await expect
    .element(dialog.getByRole('checkbox', { name: /permissionKeys.workspace.member.manage/ }))
    .toBeChecked()
  await expect
    .element(dialog.getByRole('button', { name: /permission.group.workspace/ }))
    .toHaveAttribute('aria-expanded', 'true')
  expect(dialog.getByRole('checkbox', { name: /IP Policies/ }).all()).toHaveLength(0)
  await dialog.getByRole('button', { name: 'permission.permissionList.clearAll' }).click()
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
      permission_keys: ['ip_policy.view'],
    },
  })
})

it('offers both IP policy permissions when creating a Cloud role', async () => {
  const screen = await setup({ deploymentEdition: 'CLOUD' })
  await screen.getByRole('button', { name: 'permission.role.addRole' }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByRole('checkbox', { name: /View IP Policies/ })).toBeVisible()
  await expect
    .element(dialog.getByRole('checkbox', { name: /Create, Edit and Delete IP Policies/ }))
    .toBeVisible()
})
