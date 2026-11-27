import type { Role } from '@/models/access-control'
import { userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { builtinRole, customRole, renderRolePage, rolePage } from './role-page-fixture'

let roles: Role[]
const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      current: {
        rbac: {
          rolePermissions: {
            catalog: { get: async () => ({ groups: [] }) },
          },
          roles: {
            get: async () => rolePage(roles),
            post: async ({ body }) => {
              const saved = { ...customRole, ...body, id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70' }
              roles = [...roles, saved]
              return saved
            },
            byRoleId: {
              put: async ({ params, body }) => {
                const saved = { ...customRole, ...body, id: params.role_id }
                roles = roles.map((role) => (role.id === saved.id ? saved : role))
                return saved
              },
              delete: async ({ params }) => {
                roles = roles.filter((role) => role.id !== params.role_id)
                return { result: 'success' }
              },
            },
          },
        },
      },
    },
  },
}))
beforeEach(() => {
  roles = [customRole]
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

it('shows a failed first load of the role list with a retry', async () => {
  const list = fake.console.workspaces.current.rbac.roles.get
  list.mockRejectedValueOnce(apiError({ status: 503, message: 'Roles unavailable' }))
  const screen = await setup()

  const alert = screen.getByRole('alert')
  await expect.element(alert).toBeVisible()
  await alert.getByRole('button', { name: 'common.operation.retry' }).click()

  await expect.element(screen.getByText(customRole.name)).toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  expect(list).toHaveBeenCalledTimes(2)
})

it('shows a failed permission catalog load in the role dialog with a retry', async () => {
  const catalog = fake.console.workspaces.current.rbac.rolePermissions.catalog.get
  catalog.mockRejectedValueOnce(apiError({ status: 503, message: 'Catalog unavailable' }))
  const { screen, queryClient } = await renderRolePage()
  onTestFinished(() => queryClient.clear())
  queryClient.removeQueries({
    queryKey: consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({
      input: {},
    }),
  })

  await screen.getByRole('button', { name: 'permission.role.addRole' }).click()
  const dialog = screen.getByRole('dialog')
  const alert = dialog.getByRole('alert')
  await expect.element(alert).toBeVisible()
  await expect
    .element(dialog.getByText('permission.permissionList.noPermissionsFound'))
    .not.toBeInTheDocument()
  await alert.getByRole('button', { name: 'common.operation.retry' }).click()

  await expect
    .element(dialog.getByText('permission.permissionList.noPermissionsFound'))
    .toBeVisible()
  expect(catalog).toHaveBeenCalledTimes(2)
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
  const { delete: remove } = fake.console.workspaces.current.rbac.roles.byRoleId
  const first = hold(remove)
  const retry = hold(remove)
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
  expect(await first.arrived).toEqual({ params: { role_id: customRole.id } })
  expect(remove).toHaveBeenCalledOnce()

  first.reject(apiError({ status: 500, message: 'Delete failed' }))
  await expect.element(confirm).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await retry.arrived
  expect(remove).toHaveBeenCalledTimes(2)
  const refresh = hold(fake.console.workspaces.current.rbac.roles.get)
  retry.release()

  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(customRole.name)).not.toBeInTheDocument()
  const addRole = screen.getByRole('button', { name: 'permission.role.addRole' })
  await expect.element(addRole).toHaveFocus()
  refresh.reject(apiError({ status: 500, message: 'List refresh failed' }))
  const listKey = consoleQuery.workspaces.current.rbac.roles.get.key({ type: 'infinite' })
  await expect
    .poll(() => queryClient.getQueryCache().find({ queryKey: listKey, exact: false })?.state.status)
    .toBe('error')
  await expect.element(screen.getByText(customRole.name)).not.toBeInTheDocument()
  await expect.element(addRole).toHaveFocus()
})

it('preserves trimmed role fields and permission selection across a pending failure, then refreshes the list on retry', async () => {
  const createRole = fake.console.workspaces.current.rbac.roles.post
  const pending = hold(createRole)
  const screen = await setup()
  const dialog = await openCreate(screen)
  await dialog.getByRole('button', { name: 'permission.permissionList.selectAll' }).click()
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await expect.element(dialog).toBeVisible()
  await expect.poll(() => createRole).toHaveBeenCalledOnce()
  expect(createRole).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      body: {
        name: 'New manager',
        description: 'Support team',
        permission_keys: ['workspace.member.manage'],
      },
    }),
  )
  pending.reject(apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Save failed' }))
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
  expect(fake.console.workspaces.current.rbac.roles.byRoleId.put).toHaveBeenCalledWith(
    expect.objectContaining({
      params: { role_id: customRole.id },
      body: {
        name: 'Updated manager',
        description: 'Updated description',
        permission_keys: ['ip_policy.view'],
      },
    }),
  )
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
