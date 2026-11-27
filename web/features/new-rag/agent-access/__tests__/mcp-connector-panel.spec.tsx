import type {
  KnowledgeAgentGrantResponse,
  KnowledgeAgentMineResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { consoleClient } from '@/service/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { McpConnectorButton } from '../mcp-connector-panel'

const api = vi.hoisted(() => ({
  mine: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.get>(),
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  createToken: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.tokens.post>(),
  revoke: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.grants.byGrantId.delete>(),
  update: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.grants.byGrantId.patch>(),
  workspace: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.workspace.get>(),
  setWorkspace: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.workspace.patch>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.agentAccess.get': api.mine,
      'knowledgeFs.spaces.get': api.spaces,
      'knowledgeFs.agentAccess.tokens.post': api.createToken,
      'knowledgeFs.agentAccess.grants.byGrantId.delete': api.revoke,
      'knowledgeFs.agentAccess.grants.byGrantId.patch': api.update,
      'knowledgeFs.agentAccess.workspace.get': api.workspace,
      'knowledgeFs.agentAccess.workspace.patch': api.setWorkspace,
    }),
  }
})

type SpaceListResponse = Awaited<ReturnType<typeof consoleClient.knowledgeFs.spaces.get>>
type SpaceListItem = SpaceListResponse['data'][number]

const MCP_URL = 'https://api.dify.test/mcp/knowledge'

const space = (id: string, name: string): SpaceListItem => ({
  control_space_id: id,
  created_at: '2026-07-15T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: ['knowledge_space_read'],
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: {
    description: null,
    document_count: 0,
    icon: null,
    knowledge_space_id: id,
    name,
    revision: 1,
    slug: id,
  },
  updated_at: '2026-07-18T00:00:00Z',
  visibility: 'only_me',
})

const grant = (
  overrides: Partial<KnowledgeAgentGrantResponse> = {},
): KnowledgeAgentGrantResponse => ({
  id: 'grant-1',
  kind: 'oauth',
  name: 'Claude Code',
  client_name: 'Claude Code',
  scopes: ['knowledge:read'],
  knowledge_base_ids: ['kb-handbook'],
  created_at: '2026-11-01T00:00:00Z',
  expires_at: null,
  last_used_at: null,
  ...overrides,
})

const mine = (overrides: Partial<KnowledgeAgentMineResponse> = {}): KnowledgeAgentMineResponse => ({
  available: true,
  agent_access_enabled: true,
  blocked_knowledge_base_ids: ['kb-board'],
  mcp_url: MCP_URL,
  grants: [grant()],
  ...overrides,
})

const token = (overrides: Partial<KnowledgeAgentGrantResponse> = {}) =>
  grant({
    id: 'grant-token',
    kind: 'personal',
    name: 'Local development',
    client_name: null,
    token_hint: 'V3q6',
    expires_at: '2026-12-20T00:00:00Z',
    ...overrides,
  })

async function openPanel(options: Parameters<typeof renderWithConsoleQuery>[1] = {}) {
  const user = userEvent.setup()
  renderWithConsoleQuery(<McpConnectorButton />, options)
  await user.click(screen.getByRole('button', { name: 'knowledgeSpace.agents.button' }))
  return {
    user,
    panel: await screen.findByRole('dialog', { name: 'knowledgeSpace.agents.title' }),
  }
}

async function openCreateDialog(user: ReturnType<typeof userEvent.setup>, panel: HTMLElement) {
  await user.click(await within(panel).findByRole('button', { name: /agents\.createToken$/ }))
  return screen.findByRole('dialog', { name: 'knowledgeSpace.agents.createTokenTitle' })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.mine.mockResolvedValue(mine({ grants: [grant(), token()] }))
  api.spaces.mockResolvedValue({
    data: [
      space('kb-handbook', 'Handbook'),
      space('kb-finance', 'Finance'),
      space('kb-board', 'Board'),
    ],
    has_more: false,
    limit: 100,
    page: 1,
  })
  api.workspace.mockResolvedValue({
    agent_access_enabled: true,
    grants: [
      grant(),
      grant({
        id: 'grant-2',
        name: 'Codex',
        client_name: 'Codex',
        account: { id: 'account-2', name: 'Bob', email: 'bob@example.test' },
      }),
    ],
  })
})

describe('McpConnectorPanel', () => {
  it('shows the server, the agent commands and both kinds of connection', async () => {
    const { panel } = await openPanel({ currentWorkspace: { role: 'normal' } })

    expect(await within(panel).findByText(MCP_URL)).toBeInTheDocument()
    expect(
      within(panel).getByText(`claude mcp add --transport http knowledge ${MCP_URL}`),
    ).toBeInTheDocument()
    expect(within(panel).getByText('codex mcp login knowledge')).toBeInTheDocument()

    const rows = within(panel).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    // An authorized agent has no token to hint at and never expires on its own.
    expect(rows[0]).toHaveTextContent('Claude Code')
    expect(rows[0]).toHaveTextContent('knowledgeSpace.agents.never')
    // A personal token is told apart by its last characters.
    expect(rows[1]).toHaveTextContent('Local development')
    expect(rows[1]).toHaveTextContent('•••• V3q6')
    expect(rows[1]).not.toHaveTextContent('knowledgeSpace.agents.never')
    expect(await within(rows[1]!).findByText('Handbook')).toBeInTheDocument()
    // Only workspace admins manage the workspace switch.
    expect(within(panel).queryByText('knowledgeSpace.agents.allowAgents')).not.toBeInTheDocument()
    expect(api.workspace).not.toHaveBeenCalled()
  })

  it('creates a personal token for the chosen bases and shows it once', async () => {
    api.createToken.mockResolvedValue({
      grant: token({ id: 'grant-3', name: 'Laptop' }),
      token: 'dfok_secret-token',
    })
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })
    const dialog = await openCreateDialog(user, panel)
    const submit = within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' })

    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox'), 'Laptop')
    // Still nothing to read: a name alone is not enough.
    expect(submit).toBeDisabled()
    // A base whose managers turned personal agents off cannot be chosen.
    expect(within(dialog).getByRole('checkbox', { name: /Board/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(within(dialog).getByRole('checkbox', { name: /Finance/ }))
    await user.click(submit)

    await waitFor(() =>
      expect(api.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'Laptop', knowledge_base_ids: ['kb-finance'], expires_in_days: 30 },
        }),
      ),
    )
    const created = await screen.findByRole('dialog', {
      name: 'knowledgeSpace.agents.tokenCreatedTitle',
    })
    expect(within(created).getByText('dfok_secret-token')).toBeInTheDocument()
    expect(created).toHaveTextContent('bearer_token_env_var = "KNOWLEDGE_MCP_TOKEN"')
    expect(created).toHaveTextContent(`"Authorization": "Bearer $${'{KNOWLEDGE_MCP_TOKEN}'}"`)
    // The token itself never appears in the examples.
    expect(within(created).getAllByText(/dfok_secret-token/)).toHaveLength(1)

    await user.click(within(created).getByRole('button', { name: 'knowledgeSpace.agents.done' }))
    await waitFor(() => expect(screen.queryByText('dfok_secret-token')).not.toBeInTheDocument())
  })

  it('creates tokens that never expire or last a custom number of days', async () => {
    api.createToken.mockResolvedValue({ grant: token(), token: 'dfok_secret-token' })
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })
    let dialog = await openCreateDialog(user, panel)

    await user.type(within(dialog).getByRole('textbox'), 'CI')
    await user.click(within(dialog).getByRole('checkbox', { name: /Finance/ }))
    await user.click(within(dialog).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'knowledgeSpace.agents.never' }))
    expect(within(dialog).getByText('knowledgeSpace.agents.neverExpires')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' }))

    await waitFor(() =>
      expect(api.createToken).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ expires_in_days: null }) }),
      ),
    )
    await user.click(await screen.findByRole('button', { name: 'knowledgeSpace.agents.done' }))

    dialog = await openCreateDialog(user, panel)
    // Every opening starts from an empty form.
    expect(within(dialog).getByRole('textbox')).toHaveValue('')
    await user.type(within(dialog).getByRole('textbox'), 'CI')
    await user.click(within(dialog).getByRole('checkbox', { name: /Finance/ }))
    await user.click(within(dialog).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'knowledgeSpace.agents.custom' }))
    const days = within(dialog).getByRole('textbox', { name: 'knowledgeSpace.agents.customDays' })
    await user.clear(days)
    await user.type(days, '45')
    await user.click(within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' }))

    await waitFor(() =>
      expect(api.createToken).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ expires_in_days: 45 }) }),
      ),
    )
  })

  it('names the bases the server refused', async () => {
    api.createToken.mockRejectedValue(
      createHttpError(new Response(null, { status: 422 }), {
        code: 'knowledge_base_agent_access_blocked',
        message: 'blocked',
        details: { knowledge_base_ids: ['kb-finance'] },
      }),
    )
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })
    const dialog = await openCreateDialog(user, panel)

    await user.type(within(dialog).getByRole('textbox'), 'CI')
    await user.click(await within(dialog).findByRole('checkbox', { name: /Finance/ }))
    await user.click(within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('agents.errorBlocked')
  })

  it('changes which knowledge bases a connection may read', async () => {
    api.update.mockResolvedValue(token())
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })

    await user.click(
      (await within(panel).findAllByRole('button', { name: /agents\.editAccess/ }))[1]!,
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'knowledgeSpace.agents.editTokenTitle',
    })
    expect(dialog).toHaveTextContent('•••• V3q6')
    const save = within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.saveChanges' })
    await user.click(await within(dialog).findByRole('checkbox', { name: /Handbook/ }))
    // A connection must keep at least one knowledge base.
    expect(save).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /Finance/ }))
    await user.click(save)

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { grant_id: 'grant-token' },
          body: { knowledge_base_ids: ['kb-finance'] },
        }),
      ),
    )
  })

  it('drops knowledge bases a connection can no longer have, says so, and saves the rest', async () => {
    api.mine.mockResolvedValue(
      mine({ grants: [token({ knowledge_base_ids: ['kb-handbook', 'kb-board', 'kb-gone'] })] }),
    )
    api.update.mockResolvedValue(token())
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })

    await user.click(await within(panel).findByRole('button', { name: /agents\.editAccess/ }))
    const dialog = await screen.findByRole('dialog', {
      name: 'knowledgeSpace.agents.editTokenTitle',
    })
    // Board turned personal agents off since; kb-gone is no longer among the member's bases.
    expect(await within(dialog).findByRole('checkbox', { name: /Handbook/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Board/ })).not.toBeChecked()
    expect(within(dialog).getByText(/agents\.errorBlocked.*Board/)).toBeInTheDocument()
    expect(within(dialog).getByText(/agents\.errorKnowledgeBases.*kb-gone/)).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.saveChanges' }),
    )

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { grant_id: 'grant-token' },
          body: { knowledge_base_ids: ['kb-handbook'] },
        }),
      ),
    )
  })

  it('does not create a never-expiring token from an empty custom lifetime', async () => {
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })
    const dialog = await openCreateDialog(user, panel)

    await user.type(within(dialog).getByRole('textbox'), 'CI')
    await user.click(within(dialog).getByRole('checkbox', { name: /Finance/ }))
    await user.click(within(dialog).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'knowledgeSpace.agents.custom' }))
    await user.clear(
      within(dialog).getByRole('textbox', { name: 'knowledgeSpace.agents.customDays' }),
    )

    expect(
      within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' }),
    ).toBeDisabled()
    expect(api.createToken).not.toHaveBeenCalled()
  })

  it('deletes a personal token after confirmation', async () => {
    api.revoke.mockResolvedValue(undefined)
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'normal' } })

    await user.click(await within(panel).findByRole('button', { name: /agents\.deleteNamedToken/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('knowledgeSpace.agents.deleteTokenTitle')
    expect(confirm).toHaveTextContent('•••• V3q6')
    expect(api.revoke).not.toHaveBeenCalled()
    await user.click(
      within(confirm).getByRole('button', { name: 'knowledgeSpace.agents.deleteToken' }),
    )

    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ params: { grant_id: 'grant-token' } }),
      ),
    )
  })

  it("lets admins switch the workspace off and disconnect a member's agent", async () => {
    api.setWorkspace.mockResolvedValue({ agent_access_enabled: false, grants: [] })
    api.revoke.mockResolvedValue(undefined)
    const { user, panel } = await openPanel({ currentWorkspace: { role: 'owner' } })

    const member = (await within(panel).findByText('Bob')).closest('tr')!
    // Their own connection is listed above, not among the members'.
    expect(member).toHaveTextContent('Codex')
    // Nothing the server reports says whether an agent is connected right now.
    expect(member).not.toHaveTextContent('knowledgeSpace.agents.statusConnected')
    expect(within(panel).queryByText('knowledgeSpace.agents.columnStatus')).not.toBeInTheDocument()
    expect(member).toHaveTextContent('knowledgeSpace.agents.neverUsed')
    expect(member.parentElement?.children).toHaveLength(1)

    await user.click(within(member).getByRole('button', { name: /agents\.disconnectNamed/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('agents.disconnectMemberDescription')
    await user.click(
      within(confirm).getByRole('button', { name: 'knowledgeSpace.agents.disconnect' }),
    )
    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ params: { grant_id: 'grant-2' } }),
      ),
    )

    await user.click(
      within(panel).getByRole('switch', { name: 'knowledgeSpace.agents.allowAgents' }),
    )
    await waitFor(() =>
      expect(api.setWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ body: { enabled: false } }),
      ),
    )
  })

  it('explains when the workspace switch or the deployment turns connections off', async () => {
    api.mine.mockResolvedValueOnce(mine({ agent_access_enabled: false, grants: [] }))
    const { panel } = await openPanel({ currentWorkspace: { role: 'normal' } })

    expect(
      await within(panel).findByText('knowledgeSpace.agents.workspaceDisabled'),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /agents\.createToken$/ })).toBeDisabled()
    expect(within(panel).getByText('knowledgeSpace.agents.noConnections')).toBeInTheDocument()
  })

  it('shows the unavailable state when the deployment has no agent connections', async () => {
    api.mine.mockResolvedValueOnce(mine({ available: false, grants: [] }))
    const { panel } = await openPanel()

    expect(await within(panel).findByText('knowledgeSpace.agents.unavailable')).toBeInTheDocument()
    expect(api.spaces).not.toHaveBeenCalled()
  })
})
