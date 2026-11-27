import type { AccessPolicyResourceType } from '@/models/access-control'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createAccessPolicyFixture } from '@/test/fixtures/access-policy'
import {
  permissionFor,
  renderAccessRule,
  resources,
  ruleFor,
  rulePage,
} from './access-rule-fixture'

// The journey refetches the catalog the fixture seeds; answer with the same permissions.
const catalogFor = (type: AccessPolicyResourceType) => ({
  groups: [
    {
      group_key: `${type}_acl`,
      group_name: type,
      description: '',
      permissions: [{ key: permissionFor(type), name: 'Edit configuration', description: '' }],
    },
  ],
})
// The app toaster is a separate root so its notifications outlive the settings section.
async function renderToaster() {
  await render(<AppToaster />)
  onTestFinished(() => toast.dismiss())
}
const errorToast = (name: string) => page.getByRole('dialog', { name })
let rules: ReturnType<typeof ruleFor>[]
function installAccessRuleApi() {
  const list = async () => rulePage(rules)
  return installFakeApi({
    console: {
      workspaces: {
        current: {
          rbac: {
            workspace: {
              apps: { accessPolicy: { get: list } },
              datasets: { accessPolicy: { get: list } },
              agents: { accessPolicy: { get: list } },
            },
            accessPolicies: {
              post: async ({ body }) => {
                const policy = createAccessPolicyFixture({ ...body, id: 'created-rule' })
                rules = [...rules, { policy, accounts: [], roles: [] }]
                return policy
              },
              byPolicyId: {
                delete: async ({ params }) => {
                  rules = rules.filter((rule) => rule.policy.id !== params.policy_id)
                  return { result: 'success' }
                },
              },
            },
            myPermissions: {
              get: () => ({
                workspace: { permission_keys: [] },
                app: { default_permission_keys: [], overrides: [] },
                dataset: { default_permission_keys: [], overrides: [] },
              }),
            },
            rolePermissions: {
              catalog: {
                app: { get: () => catalogFor('app') },
                dataset: { get: () => catalogFor('dataset') },
                agent: { get: () => catalogFor('agent') },
              },
            },
          },
        },
      },
    },
  })
}
let fake: ReturnType<typeof installAccessRuleApi>
const removePolicy = () => fake.console.workspaces.current.rbac.accessPolicies.byPolicyId.delete
const listAppPolicies = () => fake.console.workspaces.current.rbac.workspace.apps.accessPolicy.get
beforeEach(() => {
  fake = installAccessRuleApi()
  onTestFinished(fake)
})
async function setup(type: AccessPolicyResourceType = 'agent', canManage = true) {
  const view = await renderAccessRule(type, canManage)
  onTestFinished(() => view.queryClient.clear())
  const trigger = view.screen.getByRole('button', {
    name: new RegExp(`^permission.accessRule.${type}Title`),
  })
  if (type !== 'app') await trigger.click()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect.element(view.screen.getByText(rules[0]!.policy.name)).toBeVisible()
  return view
}

it('shows a failed permission catalog load in the permission set dialog with a retry', async () => {
  rules = [ruleFor('agent')]
  const catalog = fake.console.workspaces.current.rbac.rolePermissions.catalog.agent.get
  catalog.mockRejectedValueOnce(apiError({ status: 503, message: 'Catalog unavailable' }))
  const { screen, queryClient } = await setup('agent')
  queryClient.removeQueries({
    queryKey: consoleQuery.workspaces.current.rbac.rolePermissions.catalog.agent.get.queryKey({
      input: {},
    }),
  })

  await screen.getByRole('button', { name: 'permission.accessRule.newPermissionSet' }).click()
  const dialog = screen.getByRole('dialog')
  const alert = dialog.getByRole('alert')
  await expect.element(alert).toBeVisible()
  await alert.getByRole('button', { name: 'common.operation.retry' }).click()

  await expect
    .element(dialog.getByRole('checkbox', { name: new RegExp(permissionFor('agent')) }))
    .toBeVisible()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
  expect(catalog).toHaveBeenCalledTimes(2)
})

it.each(resources)(
  'creates a %s permission set with trimmed fields and its actual catalog selection',
  async (type) => {
    rules = [ruleFor(type)]
    const { screen } = await setup(type)
    await screen.getByRole('button', { name: 'permission.accessRule.newPermissionSet' }).click()
    const dialog = screen.getByRole('dialog')
    const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
    await expect.element(confirm).toBeDisabled()
    await dialog
      .getByRole('textbox', { name: 'permission.permissionSet.nameLabel' })
      .fill('  Custom rule  ')
    await dialog
      .getByRole('textbox', { name: 'permission.permissionSet.descriptionLabel' })
      .fill('  Can edit  ')
    const permission = dialog.getByRole('checkbox', { name: new RegExp(permissionFor(type)) })
    await permission.click()
    await expect.element(permission).toBeChecked()
    await confirm.click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(screen.getByText('Custom rule', { exact: true })).toBeVisible()
    expect(
      fake.console.workspaces.current.rbac.accessPolicies.post,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: {
          name: 'Custom rule',
          description: 'Can edit',
          resource_type: type,
          permission_keys: [permissionFor(type)],
        },
      }),
    )
  },
)

it('opens built-in Agent rules read-only through their real row action', async () => {
  rules = [ruleFor('agent')]
  rules[0]!.policy.is_builtin = true
  const { screen } = await setup()
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('menuitem', { name: 'permission.common.duplicateAction' }))
    .toBeVisible()
  await screen.getByRole('menuitem', { name: 'common.operation.view' }).click()
  const dialog = screen.getByRole('dialog')
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.permissionSet.nameLabel' }))
    .toHaveValue('agent rule')
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.permissionSet.nameLabel' }))
    .toBeDisabled()
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.permissionSet.descriptionLabel' }))
    .toBeDisabled()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.confirm' }))
    .not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('button', { name: 'permission.permissionList.clearAll' }))
    .not.toBeInTheDocument()
})

it('preserves a failed Agent permission-set draft for retry through the real mutation', async () => {
  rules = [ruleFor('agent')]
  fake.console.workspaces.current.rbac.accessPolicies.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' }),
  )
  const { screen } = await setup()
  await screen.getByRole('button', { name: 'permission.accessRule.newPermissionSet' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog
    .getByRole('textbox', { name: 'permission.permissionSet.nameLabel' })
    .fill('Agent reviewers')
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await expect
    .element(dialog.getByRole('textbox', { name: 'permission.permissionSet.nameLabel' }))
    .toHaveValue('Agent reviewers')
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('Agent reviewers', { exact: true })).toBeVisible()
})

it('removes management entry points when the member lacks permission', async () => {
  rules = [ruleFor('app')]
  const { screen } = await setup('app', false)
  await expect
    .element(screen.getByRole('button', { name: 'permission.accessRule.newPermissionSet' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.moreActions' }))
    .not.toBeInTheDocument()
})

it('closes the open mutation dialog after a real permission refetch revokes management', async () => {
  rules = [ruleFor('agent')]
  const { screen, queryClient } = await setup()
  await screen.getByRole('button', { name: 'permission.accessRule.newPermissionSet' }).click()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.rbac.myPermissions.get.key(),
  })
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'permission.accessRule.newPermissionSet' }))
    .not.toBeInTheDocument()
  expect(fake.console.workspaces.current.rbac.accessPolicies.post).not.toHaveBeenCalled()
})

it('protects the actual delete, supports retry, and returns focus before the list refresh', async () => {
  rules = [ruleFor('app')]
  const first = hold(removePolicy())
  const retry = hold(removePolicy())
  await renderToaster()
  const { screen } = await setup('app')
  const menu = screen.getByRole('button', { name: 'common.operation.moreActions' })
  await menu.click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  const cancel = dialog.getByRole('button', { name: 'common.operation.cancel' })
  const confirm = dialog.getByRole('button', { name: 'common.operation.delete' })
  await expect.element(cancel).toHaveFocus()
  await expect.element(confirm).toBeEnabled()

  // Two activations before React paints loading must still send a single DELETE.
  const button = confirm.element() as HTMLButtonElement
  button.focus()
  button.click()
  button.click()
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  await expect.element(cancel).toBeDisabled()
  expect(await first.arrived).toEqual({ params: { policy_id: rules[0]!.policy.id } })
  expect(removePolicy()).toHaveBeenCalledOnce()

  first.reject(apiError({ status: 500, message: 'Could not delete this permission set' }))
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent('Could not delete this permission set')
  await expect.element(cancel).toBeEnabled()
  await expect.element(errorToast('Could not delete this permission set')).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')

  await retry.arrived
  const refresh = hold(listAppPolicies())
  const deleted = rules[0]!.policy.name
  retry.release()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(deleted)).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /^permission.accessRule.appTitle/ }))
    .toHaveFocus()
  expect(removePolicy()).toHaveBeenCalledTimes(2)
  refresh.release()
})

it('keeps Escape and menu focus return available during an ordinary list refresh', async () => {
  rules = [ruleFor('app')]
  const { screen, queryClient } = await setup('app')
  const menu = screen.getByRole('button', { name: 'common.operation.moreActions' })
  await menu.click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  await expect.element(dialog).toBeVisible()
  const refresh = hold(listAppPolicies())
  const fetching = queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.rbac.workspace.apps.accessPolicy.get.key(),
  })
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.delete' }))
    .toBeEnabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menu).toHaveFocus()
  expect(removePolicy()).not.toHaveBeenCalled()
  refresh.release()
  await fetching
})

it('reports a deletion failure if the settings section closes during the request', async () => {
  rules = [ruleFor('app')]
  const request = hold(removePolicy())
  await renderToaster()
  const { screen } = await setup('app')
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'common.operation.delete' }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await screen.unmount()
  await request.arrived
  request.reject(apiError({ status: 500, message: 'Permission set deletion failed' }))
  await expect.element(errorToast('Permission set deletion failed')).toBeVisible()
})

it('returns focus to the section heading in view after deleting a low row', async () => {
  await page.viewport(1100, 245)
  rules = Array.from({ length: 8 }, (_, index) => {
    const rule = ruleFor('app', `Permission set ${index + 1}`)
    rule.policy.id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    return rule
  })
  const { screen } = await setup('app')
  const heading = screen.getByRole('button', { name: /^permission.accessRule.appTitle/ })
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).last().click()
  await expect.element(heading).not.toBeInViewport()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'common.operation.delete' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(heading).toHaveFocus()
  await expect.element(heading).toBeInViewport()
})
