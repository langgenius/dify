import type { AccessPolicyResourceType } from '@/models/access-control'
import { consoleQuery } from '@/service/console'
import { apiError, installFakeApi } from '@/test/fake-api'
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
