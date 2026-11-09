import type {
  KnowledgeAgentGrantResponse,
  KnowledgeAgentMineResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { consoleClient } from '@/service/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AgentConnectionsButton } from '../agent-connections-dialog'

const api = vi.hoisted(() => ({
  mine: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.get>(),
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  createToken: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.tokens.post>(),
  revoke: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.grants.byGrantId.delete>(),
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

async function openDialog(options: Parameters<typeof renderWithConsoleQuery>[1] = {}) {
  const user = userEvent.setup()
  renderWithConsoleQuery(<AgentConnectionsButton />, options)
  await user.click(screen.getByRole('button', { name: 'knowledgeSpace.agents.button' }))
  return { user, dialog: await screen.findByRole('dialog') }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.mine.mockResolvedValue(mine())
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
        kind: 'personal',
        name: 'CI',
        client_name: null,
        account: { id: 'account-2', name: 'Bob', email: 'bob@example.test' },
      }),
    ],
  })
})

describe('AgentConnectionsDialog', () => {
  it('shows the MCP server, the agent commands and your connections', async () => {
    const { dialog } = await openDialog({ currentWorkspace: { role: 'normal' } })

    expect(await within(dialog).findByText(MCP_URL)).toBeInTheDocument()
    expect(
      within(dialog).getByText(`claude mcp add --transport http dify-knowledge ${MCP_URL}`),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('codex mcp login dify-knowledge')).toBeInTheDocument()
    expect(within(within(dialog).getByRole('list')).getByText('Claude Code')).toBeInTheDocument()
    expect(await within(dialog).findByText('Handbook')).toBeInTheDocument()
    // Only workspace admins manage the workspace switch.
    expect(within(dialog).queryByText('knowledgeSpace.agents.allowAgents')).not.toBeInTheDocument()
    expect(api.workspace).not.toHaveBeenCalled()
  })

  it('creates a personal token for the chosen bases and shows it once', async () => {
    api.createToken.mockResolvedValue({
      grant: grant({ id: 'grant-3', kind: 'personal', name: 'Laptop', client_name: null }),
      token: 'dfok_secret-token',
    })
    const { user, dialog } = await openDialog({ currentWorkspace: { role: 'normal' } })

    await user.click(await within(dialog).findByRole('button', { name: /agents\.createToken/ }))
    await user.type(within(dialog).getByRole('textbox'), 'Laptop')
    // A base whose managers turned personal agents off cannot be chosen.
    expect(within(dialog).getByRole('checkbox', { name: /Board/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(within(dialog).getByRole('checkbox', { name: /Finance/ }))
    await user.click(within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' }))

    await waitFor(() =>
      expect(api.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'Laptop', knowledge_base_ids: ['kb-finance'], expires_in_days: 30 },
        }),
      ),
    )
    expect(await within(dialog).findByText('dfok_secret-token')).toBeInTheDocument()
    expect(within(dialog).getByText('knowledgeSpace.agents.tokenCreated')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/bearer_token_env_var = "DIFY_KNOWLEDGE_TOKEN"/),
    ).toBeInTheDocument()
  })

  it('names the bases the server refused', async () => {
    api.createToken.mockRejectedValue(
      createHttpError(new Response(null, { status: 422 }), {
        code: 'knowledge_base_agent_access_blocked',
        message: 'blocked',
        details: { knowledge_base_ids: ['kb-finance'] },
      }),
    )
    const { user, dialog } = await openDialog({ currentWorkspace: { role: 'normal' } })

    await user.click(await within(dialog).findByRole('button', { name: /agents\.createToken/ }))
    await user.type(within(dialog).getByRole('textbox'), 'CI')
    await user.click(await within(dialog).findByRole('checkbox', { name: /Finance/ }))
    await user.click(within(dialog).getByRole('button', { name: 'knowledgeSpace.agents.create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('agents.errorBlocked')
  })

  it('disconnects a connection after confirmation', async () => {
    api.revoke.mockResolvedValue(undefined)
    const { user, dialog } = await openDialog({ currentWorkspace: { role: 'normal' } })

    await user.click(
      await within(dialog).findByRole('button', { name: 'knowledgeSpace.agents.disconnect' }),
    )
    const confirm = await screen.findByRole('alertdialog')
    await user.click(
      within(confirm).getByRole('button', { name: 'knowledgeSpace.agents.disconnect' }),
    )

    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ params: { grant_id: 'grant-1' } }),
      ),
    )
  })

  it("lets admins switch the workspace off and see members' connections", async () => {
    api.setWorkspace.mockResolvedValue({ agent_access_enabled: false, grants: [] })
    const { user, dialog } = await openDialog({ currentWorkspace: { role: 'owner' } })

    expect(await within(dialog).findByText('Bob · CI')).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('switch', { name: 'knowledgeSpace.agents.allowAgents' }),
    )

    await waitFor(() =>
      expect(api.setWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ body: { enabled: false } }),
      ),
    )
  })

  it('explains when the workspace switch or the deployment turns connections off', async () => {
    api.mine.mockResolvedValueOnce(mine({ agent_access_enabled: false }))
    const { dialog } = await openDialog({ currentWorkspace: { role: 'normal' } })

    expect(
      await within(dialog).findByText('knowledgeSpace.agents.workspaceDisabled'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /agents\.createToken/ })).toBeDisabled()
  })

  it('shows the unavailable state when the deployment has no agent connections', async () => {
    api.mine.mockResolvedValueOnce(mine({ available: false, grants: [] }))
    const { dialog } = await openDialog()

    expect(await within(dialog).findByText('knowledgeSpace.agents.unavailable')).toBeInTheDocument()
    expect(api.spaces).not.toHaveBeenCalled()
  })
})
