import type { Role } from '@/models/access-control'
import type { consoleClient } from '@/service/console'
import { installFakeApi } from '@/test/fake-api'
import {
  builtinRole as builtinRoleFixture,
  customRole as customRoleFixture,
  renderRolePage,
  rolePage,
} from './role-page-fixture'

// Role routes take UUID path parameters.
const customRole = { ...customRoleFixture, id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }
const builtinRole = { ...builtinRoleFixture, id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e' }
const api = {
  list: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.get>(),
  copy: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.copy.post>(),
  members: vi.fn<typeof consoleClient.workspaces.current.rbac.roles.byRoleId.members.get>(),
}
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
    const saved = {
      ...customRole,
      id: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
      name: `${roles[0]!.name} copy`,
    }
    roles = [...roles, saved]
    return saved
  })
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: {
          current: {
            rbac: {
              roles: {
                get: (input) => api.list(input),
                byRoleId: {
                  copy: { post: (input) => api.copy(input) },
                  members: { get: (input) => api.members(input) },
                },
              },
            },
          },
        },
      },
    }),
  )
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
    expect(api.copy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        params: { role_id: role.id },
        body: { copy_member: copyMembers },
      }),
    )
  },
)
