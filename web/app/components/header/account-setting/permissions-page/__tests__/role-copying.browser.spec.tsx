import type { Role } from '@/models/access-control'
import type { consoleClient } from '@/service/console'
import { builtinRole, customRole, renderRolePage, rolePage } from './role-page-fixture'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.get>(),
  copy: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.copy.post>(),
  members: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.members.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': api.list,
      'workspaces.current.rbac.roles.byRoleId.copy.post': api.copy,
      'workspaces.current.rbac.roles.byRoleId.members.get': api.members,
    }),
  }
})
let roles: Role[]
beforeEach(() => {
  api.list.mockReset().mockImplementation(async () => rolePage(roles))
  api.members.mockReset().mockResolvedValue({
    data: ['Alice', 'Bob', 'Carol'].map((name) => ({
      account_id: name.toLowerCase(),
      account_name: name,
    })),
    pagination: { total_count: 3, per_page: 9999, current_page: 1, total_pages: 1 },
  })
  api.copy.mockReset().mockImplementation(async () => {
    const saved = { ...customRole, id: 'copied-role', name: `${roles[0]!.name} copy` }
    roles = [...roles, saved]
    return saved
  })
})
it.each([
  { role: builtinRole, action: 'common.operation.skip', copyMembers: false },
  { role: { ...customRole, name: 'Support' }, action: 'common.operation.copy', copyMembers: true },
])(
  'duplicates $role.name with the chosen member assignment option',
  async ({ role, action, copyMembers }) => {
    roles = [role]
    const { screen, queryClient } = await renderRolePage()
    onTestFinished(() => queryClient.clear())
    await screen.getByRole('button', { name: 'common.operation.moreActions' }).click()
    await screen.getByRole('menuitem', { name: 'permission.common.duplicateAction' }).click()
    const dialog = screen.getByRole('alertdialog')
    await expect
      .element(dialog)
      .toMatchTextContent(
        `permission.role.copyMembersDescription:{"name":"${role.name}","count":3}`,
      )
    await dialog.getByRole('button', { name: action }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(screen.getByText(`${role.name} copy`, { exact: true })).toBeVisible()
    expect(api.copy).toHaveBeenCalledExactlyOnceWith({
      params: { role_id: role.id },
      body: { copy_member: copyMembers },
    })
  },
)
