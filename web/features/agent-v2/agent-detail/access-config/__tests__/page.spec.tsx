import { zResourceUserAccessPolicies } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPermission } from '@/features/agent-v2/acl'
import { RESOURCE_ACCESS_SETTINGS_PAGE_SIZE } from '@/service/access-control/constants'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAccessPolicyFixture } from '@/test/fixtures/access-policy'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentAccessConfigPage } from '../page'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const resource = consoleQuery.workspaces.current.rbac.agents.byAgentId
const params = { agent_id: 'agent-1' }
const policy = createAccessPolicyFixture()
const sent: Request[] = []
const createUser = (id: string, name: string, policies = [policy]) =>
  zResourceUserAccessPolicies.parse({
    account: { account_id: id, account_name: name, email: `${id}@example.com` },
    access_policies: policies,
    roles: [],
  })

function setup({
  automatic = false,
  users = [createUser('evan', 'Evan')],
  permissions = [AgentPermission.AccessConfig] as string[],
} = {}) {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: true },
  })
  const detailKey = consoleQuery.agent.byAgentId.get.queryKey({ input: { params } })
  queryClient.setQueryData(detailKey, createAgentFixture({ permission_keys: permissions }))
  const state = { automatic, users, failUsers: false }
  const userPage = (page = 1, size: number = RESOURCE_ACCESS_SETTINGS_PAGE_SIZE) => ({
    data: state.users.slice((page - 1) * size, page * size),
    pagination: {
      current_page: page,
      per_page: size,
      total_count: state.users.length,
      total_pages: Math.ceil(state.users.length / size),
    },
  })
  queryClient.setQueryData(
    resource.accessPolicy.get.queryKey({ input: { params, query: { language: 'en' } } }),
    { agent_id: 'agent-1', items: [{ policy, roles: [], accounts: [] }] },
  )
  queryClient.setQueryData(
    resource.userAccessPolicies.get.queryKey({
      input: {
        params,
        query: { language: 'en', page: 1, limit: RESOURCE_ACCESS_SETTINGS_PAGE_SIZE },
      },
    }),
    userPage(),
  )
  queryClient.setQueryData(resource.whitelist.get.queryKey({ input: { params } }), {
    account_ids: users.map((user) => user.account.account_id),
  })
  queryClient.setQueryData(resource.whitelistConfig.get.queryKey({ input: { params } }), {
    automatic_include_workspace_members: automatic,
  })
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const req = options.request
      sent.push(req.clone())
      const url = new URL(req.url)
      if (req.method === 'GET') {
        if (url.pathname.endsWith('/user-access-policies')) {
          if (state.failUsers) return Response.json({ message: 'Unavailable' }, { status: 500 })
          return Response.json(
            userPage(Number(url.searchParams.get('page')), Number(url.searchParams.get('limit'))),
          )
        }
        if (url.pathname.endsWith('/whitelist_config'))
          return Response.json({ automatic_include_workspace_members: state.automatic })
        if (url.pathname.endsWith('/whitelist'))
          return Response.json({ account_ids: state.users.map((user) => user.account.account_id) })
        if (url.pathname.endsWith('/access-policy')) return Response.json({ items: [{ policy }] })
        if (url.pathname.endsWith('/members'))
          return Response.json({
            accounts: [
              {
                id: 'mia',
                name: 'Mia',
                email: 'mia@example.com',
                role: 'normal',
                status: 'active',
              },
            ],
          })
        if (url.pathname.endsWith('/agent/agent-1'))
          return Response.json(createAgentFixture({ permission_keys: permissions }))
      }
      if (req.method === 'PUT' && url.pathname.endsWith('/whitelist')) {
        const body = await req.json()
        state.automatic = body.automatic_include_workspace_members
        return Response.json({ account_ids: state.users.map((user) => user.account.account_id) })
      }
      if (req.method === 'PUT' && url.pathname.endsWith('/access-policies')) {
        const body = await req.json()
        const id = url.pathname.split('/users/')[1]!.split('/')[0]!
        const policies = body.access_policy_ids.includes(policy.id) ? [policy] : []
        state.users = [
          ...state.users.filter((user) => user.account.account_id !== id),
          createUser(id, id === 'mia' ? 'Mia' : 'Evan', policies),
        ]
        return Response.json({ access_policies: policies })
      }
      if (req.method === 'DELETE') {
        const body = await req.json()
        state.users = state.users.filter(
          (user) => !body.account_ids.includes(user.account.account_id),
        )
        return Response.json({ result: 'success' })
      }
      throw new Error(`Unexpected request ${req.method} ${url.pathname}`)
    },
  )
  return {
    ...render(<AgentAccessConfigPage agentId="agent-1" />, { wrapper }),
    queryClient,
    detailKey,
    state,
  }
}

const inclusionSwitch = () =>
  screen.getByRole('switch', { name: 'permission.accessRule.automaticallyIncludeWorkspaceMembers' })

describe('AgentAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sent.length = 0
  })

  it('uses the server inclusion setting and disables adding or removing automatic members', () => {
    setup({ automatic: true })
    expect(inclusionSwitch()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeEnabled()
    expect(request).not.toHaveBeenCalled()
  })

  it('updates automatic inclusion and refreshes resource permissions', async () => {
    const { queryClient, detailKey } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(inclusionSwitch())
    await waitFor(() => expect(inclusionSwitch()).toHaveAttribute('aria-checked', 'true'))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey }))
    const mutation = sent.find((req) => req.method === 'PUT')!
    expect(new URL(mutation.url).pathname).toMatch(/\/agents\/agent-1\/whitelist$/)
    expect(await mutation.json()).toEqual({ automatic_include_workspace_members: true })
  })

  it('adds a workspace member with the default permission set', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'permission.accessRule.addMemberAria:{"name":"Mia"}',
      }),
    )
    await waitFor(() => expect(screen.getByRole('row', { name: /Mia/ })).toBeInTheDocument())
    const mutation = sent.find((req) => req.method === 'PUT')!
    expect(new URL(mutation.url).pathname).toMatch(/\/users\/mia\/access-policies$/)
    expect(await mutation.json()).toEqual({ access_policy_ids: ['default'] })
  })

  it('updates a member policy using the selected policy id', async () => {
    setup({ users: [createUser('evan', 'Evan', [])] })
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: policy.name }))
    await waitFor(() => expect(sent.some((req) => req.method === 'PUT')).toBe(true))
    expect(await sent.find((req) => req.method === 'PUT')!.json()).toEqual({
      access_policy_ids: [policy.id],
    })
  })

  it('batch removes members by their policy bindings', async () => {
    setup({ users: [createUser('evan', 'Evan'), createUser('mia', 'Mia', [])] })
    await userEvent.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.sure',
      }),
    )
    await waitFor(() =>
      expect(screen.getByText('permission.accessRule.noUserAccessSettings')).toBeInTheDocument(),
    )
    const removals = sent.filter((req) => req.method === 'DELETE')
    expect(removals.map((req) => new URL(req.url).pathname)).toEqual([
      `/console/api/workspaces/current/rbac/agents/agent-1/access-policies/${policy.id}/member-bindings`,
      '/console/api/workspaces/current/rbac/agents/agent-1/access-policies/default/member-bindings',
    ])
    expect(await Promise.all(removals.map((req) => req.json()))).toEqual([
      { account_ids: ['evan'] },
      { account_ids: ['mia'] },
    ])
  })

  it('returns to the previous page after removing its last member', async () => {
    const users = Array.from({ length: RESOURCE_ACCESS_SETTINGS_PAGE_SIZE + 1 }, (_, i) =>
      createUser(`user-${i}`, `Member ${i}`),
    )
    setup({ users })
    await userEvent.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    const lastRow = await screen.findByRole('row', {
      name: new RegExp(`Member ${RESOURCE_ACCESS_SETTINGS_PAGE_SIZE}`),
    })
    await userEvent.click(within(lastRow).getByRole('button', { name: 'common.operation.remove' }))
    await screen.findByRole('row', { name: /Member 0/ })
    expect(screen.getByRole('button', { name: 'common.pagination.previous' })).toBeDisabled()
  })

  it('shows a retry action when member pagination fails', async () => {
    const { state } = setup({
      users: Array.from({ length: RESOURCE_ACCESS_SETTINGS_PAGE_SIZE + 1 }, (_, i) =>
        createUser(`user-${i}`, `Member ${i}`),
      ),
    })
    state.failUsers = true
    await userEvent.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    await screen.findByRole('alert')
    state.failUsers = false
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await screen.findByRole('row', {
      name: new RegExp(`Member ${RESOURCE_ACCESS_SETTINGS_PAGE_SIZE}`),
    })
  })

  it('removes management UI when access_config is revoked', async () => {
    const { queryClient, detailKey } = setup()
    act(() => {
      queryClient.setQueryData(
        detailKey,
        createAgentFixture({ permission_keys: [AgentPermission.Preview] }),
      )
    })
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument())
    expect(request).not.toHaveBeenCalled()
  })
})
