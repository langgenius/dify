import type { AccessPolicyResourceType } from '@/models/access-control'
import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createAccessPolicyFixture } from '@/test/fixtures/access-policy'
import {
  permissionFor,
  renderAccessRule,
  resources,
  ruleFor,
  rulePage,
} from './access-rule-fixture'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.workspaces.current.rbac.workspace.apps.accessPolicy.get>(),
  create: vi.fn<typeof consoleClient.workspaces.current.rbac.accessPolicies.post>(),
  notifyError: vi.fn(),
  remove: vi.fn<typeof consoleClient.workspaces.current.rbac.accessPolicies.byPolicyId.delete>(),
  permissions: vi.fn<typeof consoleClient.workspaces.current.rbac.myPermissions.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.workspace.apps.accessPolicy.get': api.list,
      'workspaces.current.rbac.workspace.datasets.accessPolicy.get': api.list,
      'workspaces.current.rbac.workspace.agents.accessPolicy.get': api.list,
      'workspaces.current.rbac.accessPolicies.post': api.create,
      'workspaces.current.rbac.accessPolicies.byPolicyId.delete': api.remove,
      'workspaces.current.rbac.myPermissions.get': api.permissions,
    }),
  }
})
// boundary: Observe notifications that outlive the settings section without mounting the app toaster.
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return { ...actual, toast: { ...actual.toast, error: api.notifyError } }
})
let rules: ReturnType<typeof ruleFor>[]
beforeEach(() => {
  api.list.mockReset().mockImplementation(async () => rulePage(rules))
  api.create.mockReset().mockImplementation(async ({ body }) => {
    const policy = createAccessPolicyFixture({ ...body, id: 'created-rule' })
    rules = [...rules, { policy, accounts: [], roles: [] }]
    return policy
  })
  api.notifyError.mockReset()
  api.remove.mockReset()
  api.permissions.mockReset().mockResolvedValue({
    workspace: { permission_keys: [] },
    app: { default_permission_keys: [], overrides: [] },
    dataset: { default_permission_keys: [], overrides: [] },
  })
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
    expect(api.create).toHaveBeenCalledExactlyOnceWith({
      body: {
        name: 'Custom rule',
        description: 'Can edit',
        resource_type: type,
        permission_keys: [permissionFor(type)],
      },
    })
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
  api.create.mockRejectedValueOnce(new Error('Unavailable'))
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
  expect(api.create).not.toHaveBeenCalled()
})

it('protects the actual delete, supports retry, and returns focus before the list refresh', async () => {
  rules = [ruleFor('app')]
  const first = createDeferred<Awaited<ReturnType<typeof api.remove>>>()
  const retry = createDeferred<Awaited<ReturnType<typeof api.remove>>>()
  const refresh = createDeferred<ReturnType<typeof rulePage>>()
  api.remove.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
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
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({ params: { policy_id: 'app-rule' } })

  first.reject(new Error('Could not delete this permission set'))
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent('Could not delete this permission set')
  await expect.element(cancel).toBeEnabled()
  expect(api.notifyError).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')

  api.list.mockReturnValue(refresh.promise)
  retry.resolve({ result: 'success' })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(rules[0]!.policy.name)).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /^permission.accessRule.appTitle/ }))
    .toHaveFocus()
  expect(api.remove).toHaveBeenCalledTimes(2)
  refresh.resolve(rulePage([]))
})

it('keeps Escape and menu focus return available during an ordinary list refresh', async () => {
  rules = [ruleFor('app')]
  const { screen, queryClient } = await setup('app')
  const menu = screen.getByRole('button', { name: 'common.operation.moreActions' })
  await menu.click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  await expect.element(dialog).toBeVisible()
  const refresh = createDeferred<ReturnType<typeof rulePage>>()
  api.list.mockReturnValueOnce(refresh.promise)
  const fetching = queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.rbac.workspace.apps.accessPolicy.get.key(),
  })
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.delete' }))
    .toBeEnabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menu).toHaveFocus()
  expect(api.remove).not.toHaveBeenCalled()
  refresh.resolve(rulePage(rules))
  await fetching
})

it('reports a deletion failure if the settings section closes during the request', async () => {
  rules = [ruleFor('app')]
  const request = createDeferred<Awaited<ReturnType<typeof api.remove>>>()
  api.remove.mockReturnValueOnce(request.promise)
  const { screen } = await setup('app')
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'common.operation.delete' }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await screen.unmount()
  request.reject(new Error('Permission set deletion failed'))
  await expect.poll(() => api.notifyError.mock.calls).toEqual([['Permission set deletion failed']])
})

it('returns focus to the section heading in view after deleting a low row', async () => {
  await page.viewport(1100, 245)
  rules = Array.from({ length: 8 }, (_, index) => {
    const rule = ruleFor('app', `Permission set ${index + 1}`)
    rule.policy.id = `app-rule-${index + 1}`
    return rule
  })
  const removed = rules.at(-1)!
  api.remove.mockImplementation(async () => {
    rules = rules.filter((rule) => rule !== removed)
    return { result: 'success' }
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
