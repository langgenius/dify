import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MembersPage from '../index'

const { membersRequest, rolesRequest, memberRolesRequest, updateRoles, inviteMember } = vi.hoisted(
  () => ({
    membersRequest: vi.fn(),
    rolesRequest: vi.fn(),
    memberRolesRequest: vi.fn(),
    updateRoles: vi.fn(),
    inviteMember: vi.fn(),
  }),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': async () =>
        (await import('@dify/contracts/api/console/features/zod.gen')).zGetFeaturesResponse.parse({
          is_allow_transfer_workspace: true,
        }),
      'workspaces.current.members.get': membersRequest,
      'workspaces.current.rbac.roles.get': rolesRequest,
      'workspaces.current.rbac.members.byMemberId.rbacRoles.get': memberRolesRequest,
      'workspaces.current.rbac.members.byMemberId.rbacRoles.put': updateRoles,
      'workspaces.current.members.inviteEmail.post': inviteMember,
    }),
  }
})
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow: (value: number) => `active:${value}` }),
}))

const createRole = (overrides: Partial<Role>): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Role',
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

const defaultAccounts: AccountWithRoleResponse[] = [
  {
    id: '1',
    name: 'Owner User',
    email: 'owner@example.com',
    avatar: '',
    avatar_url: '',
    role: 'owner',
    last_active_at: 1731000000,
    last_login_at: 1731000000,
    created_at: 1731000000,
    status: 'active',
    roles: [createRole({ id: 'owner-role', name: 'Owner', is_builtin: true, role_tag: 'owner' })],
  },
  {
    id: '2',
    name: 'Admin User',
    email: 'admin@example.com',
    avatar: '',
    avatar_url: '',
    role: 'admin',
    last_active_at: 1731000000,
    last_login_at: 1731000000,
    created_at: 1731000000,
    status: 'active',
    roles: [createRole({ id: 'admin-role', name: 'Admin', is_builtin: true })],
  },
]

let accounts: AccountWithRoleResponse[]
const choices = [
  createRole({ id: 'admin', name: 'Admin' }),
  createRole({ id: 'role-next', name: 'Next role' }),
  createRole({ id: 'role-extra', name: 'Extra role' }),
]
async function renderMembersPage(options: ConsoleQueryTestOptions = {}) {
  const view = renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <MembersPage />
    </NuqsTestingAdapter>,
    {
      accountProfile: { id: '1', email: 'owner@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'owner' },
      workspacePermissionKeys: ['workspace.member.manage'],
      features: { is_allow_transfer_workspace: true },
      systemFeatures: { is_email_setup: true },
      ...options,
    },
  )
  await screen.findByRole('button', { name: 'Admin User' })
  return view
}
const detailsDialog = () => screen.getByRole('dialog', { name: /members\.memberDetails\.title/ })
async function chooseRoles(user: ReturnType<typeof userEvent.setup>, multiple: boolean) {
  await user.click(screen.getByRole('button', { name: 'Admin User' }))
  const details = detailsDialog()
  await user.click(
    within(details).getByRole('button', {
      name: multiple ? /memberDetails\.assign(?=$|:)/ : 'common.operation.edit',
    }),
  )
  await user.click(await screen.findByRole(multiple ? 'checkbox' : 'radio', { name: /Next role/ }))
  if (multiple) await user.click(screen.getByRole('checkbox', { name: /Extra role/ }))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  return details
}

beforeEach(() => {
  vi.clearAllMocks()
  accounts = structuredClone(defaultAccounts)
  membersRequest.mockImplementation(async () => ({ accounts }))
  rolesRequest.mockResolvedValue({
    data: choices,
    pagination: { current_page: 1, total_pages: 1, total_count: 3, per_page: 20 },
  })
  memberRolesRequest.mockResolvedValue({ roles: [] })
  updateRoles.mockImplementation(
    async ({ params, body }: { params: { member_id: string }; body: { role_ids: string[] } }) => {
      accounts = accounts.map((account) =>
        account.id === params.member_id
          ? { ...account, roles: choices.filter((role) => body.role_ids.includes(role.id)) }
          : account,
      )
      return { result: 'success' }
    },
  )
  inviteMember.mockResolvedValue({
    result: 'success',
    tenant_id: 'tenant-id',
    invitation_results: [
      { email: 'sent@example.com', status: 'success', url: 'http://invite/link' },
    ],
  })
})

describe('MembersPage', () => {
  it('shows account roles and the created time fallback in separate table cells', async () => {
    accounts[1] = { ...accounts[1]!, last_active_at: null, created_at: 1700000000 }
    await renderMembersPage()
    const row = screen.getByRole('row', { name: /admin@example.com/ })
    expect(within(row).getByRole('cell', { name: 'active:1700000000000' })).toBeInTheDocument()
    expect(within(row).getByRole('cell', { name: 'Admin' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Admin User' })).not.toHaveTextContent(
      'admin@example.com',
    )
  })

  it('sends an invitation and displays the returned invitation link', async () => {
    const user = userEvent.setup()
    await renderMembersPage()
    await user.click(screen.getByRole('button', { name: /members\.invite$/ }))
    await user.type(
      screen.getByRole('textbox', { name: /members\.emailRecipients/ }),
      'sent@example.com',
    )
    await user.click(screen.getByRole('combobox', { name: /members\.role/ }))
    await user.click(await screen.findByRole('option', { name: /Admin/ }))
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/ }))
    expect(
      await screen.findByRole('dialog', { name: /members\.invitationSent$/ }),
    ).toBeInTheDocument()
    expect(inviteMember).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'http://invite/link' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /members\.ok$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    ['owner', 'owner@example.com', 'Owner User'],
    ['admin', 'admin@example.com', 'Admin User'],
  ] as const)(
    'does not allow assigning roles to the %s current member',
    async (role, email, name) => {
      const user = userEvent.setup()
      await renderMembersPage({ currentWorkspace: { role }, accountProfile: { email } })
      await user.click(screen.getByRole('button', { name }))
      const dialog = detailsDialog()
      expect(
        within(dialog).queryByRole('button', { name: 'common.operation.save' }),
      ).not.toBeInTheDocument()
      expect(
        within(dialog).queryByRole('button', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
      expect(updateRoles).not.toHaveBeenCalled()
    },
  )

  it('hides member management without permission while allowing member details', async () => {
    const user = userEvent.setup()
    await renderMembersPage({ currentWorkspace: { role: 'normal' }, workspacePermissionKeys: [] })
    expect(screen.queryByRole('button', { name: /members\.invite$/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /members\.memberActions(?=$|:)/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /account\.editWorkspaceInfo/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Admin User' }))
    expect(
      within(detailsDialog()).queryByRole('button', { name: 'common.operation.save' }),
    ).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'saves selected roles and refreshes the member row with RBAC=%s',
    async (multiple) => {
      const user = userEvent.setup()
      await renderMembersPage({ systemFeatures: { is_email_setup: true, rbac_enabled: multiple } })
      const dialog = await chooseRoles(user, multiple)
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
      await waitFor(() =>
        expect(updateRoles).toHaveBeenCalledWith({
          params: { member_id: '2' },
          body: { role_ids: multiple ? ['role-next', 'role-extra'] : ['role-next'] },
        }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(
        await within(screen.getByRole('row', { name: /admin@example.com/ })).findByText(
          'Next role',
        ),
      ).toBeInTheDocument()
    },
  )

  it('keeps role edits while saving and after failure, then closes only after a successful retry', async () => {
    const user = userEvent.setup()
    let rejectSave!: (error: Error) => void
    updateRoles.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    await renderMembersPage()
    const dialog = await chooseRoles(user, false)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.click(save)
    await user.click(save)
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    expect(updateRoles).toHaveBeenCalledOnce()
    await act(async () => {
      rejectSave(new Error('Save failed'))
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(within(dialog).getByText('Next role')).toBeInTheDocument()
    await user.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateRoles).toHaveBeenCalledTimes(2)
  })

  it('opens ownership transfer from the owner action without opening member details', async () => {
    const user = userEvent.setup()
    await renderMembersPage()
    await user.click(
      within(screen.getByRole('row', { name: /owner@example.com/ })).getByRole('button', {
        name: /members\.memberActions(?=$|:)/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: /members\.transferOwnership$/ }))
    expect(
      await screen.findByRole('dialog', { name: /members\.transferModal\.title/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: /members\.memberDetails\.title/ }),
    ).not.toBeInTheDocument()
  })

  it('disables ownership transfer when the feature is unavailable', async () => {
    await renderMembersPage({ features: { is_allow_transfer_workspace: false } })
    expect(
      within(screen.getByRole('row', { name: /owner@example.com/ })).queryByRole('button', {
        name: /members\.memberActions(?=$|:)/,
      }),
    ).not.toBeInTheDocument()
  })

  it('discards a canceled workspace name edit before reopening', async () => {
    const user = userEvent.setup()
    await renderMembersPage()
    const edit = screen.getByRole('button', { name: /account\.editWorkspaceInfo/ })
    await user.click(edit)
    const input = screen.getByRole('textbox', { name: /account\.workspaceName$/ })
    await user.clear(input)
    await user.type(input, 'Unsaved name')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(edit)
    expect(screen.getByRole('textbox', { name: /account\.workspaceName$/ })).toHaveValue(
      'Test Workspace',
    )
  })

  it.each([
    ['sandbox', 5, 'plansCommon.member'],
    ['sandbox', 0, 'plansCommon.unlimited'],
    ['team', 50, 'plansCommon.memberAfter'],
  ] as const)('shows the %s member allowance with limit %s', async (plan, limit, label) => {
    await renderMembersPage({
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { billing: { subscription: { plan } }, members: { size: 2, limit } },
    })
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
  })

  it('keeps invitation available at the displayed plan limit', async () => {
    const user = userEvent.setup()
    await renderMembersPage({
      systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true },
      features: { billing: { subscription: { plan: 'sandbox' } }, members: { size: 2, limit: 2 } },
    })
    await user.click(screen.getByRole('button', { name: /members\.invite$/ }))
    expect(screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })).toBeInTheDocument()
  })
})
