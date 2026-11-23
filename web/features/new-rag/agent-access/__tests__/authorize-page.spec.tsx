import type { KnowledgeAgentAuthorizationResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { consoleClient } from '@/service/console'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeAgentAuthorizePage } from '../authorize-page'

const api = vi.hoisted(() => ({
  describe: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.authorize.get>(),
  decide: vi.fn<typeof consoleClient.knowledgeFs.agentAccess.authorize.post>(),
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  assign: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useSearchParams: () => api.searchParams,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.agentAccess.authorize.get': api.describe,
      'knowledgeFs.agentAccess.authorize.post': api.decide,
      'knowledgeFs.spaces.get': api.spaces,
      'workspaces.get': async () => ({
        workspaces: [{ id: 'tenant-1', name: 'Acme', current: true }],
      }),
    }),
  }
})

type SpaceListItem = Awaited<
  ReturnType<typeof consoleClient.knowledgeFs.spaces.get>
>['data'][number]

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

const described = (
  overrides: Partial<KnowledgeAgentAuthorizationResponse> = {},
): KnowledgeAgentAuthorizationResponse => ({
  agent_access_enabled: true,
  blocked_knowledge_base_ids: ['kb-board'],
  client: { kind: 'dcr', name: 'Claude Code', redirect_host: '127.0.0.1:33418' },
  scopes: ['knowledge:read'],
  workspace: { id: 'tenant-1', name: 'Acme' },
  ...overrides,
})

const REQUEST = {
  response_type: 'code',
  client_id: 'dfokc_client',
  redirect_uri: 'http://127.0.0.1:33418/callback',
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
  state: 'state-1',
  resource: 'https://api.dify.test/mcp/knowledge',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.searchParams = new URLSearchParams({ ...REQUEST, unrelated: 'ignored' })
  api.describe.mockResolvedValue(described())
  api.spaces.mockResolvedValue({
    data: [space('kb-handbook', 'Handbook'), space('kb-board', 'Board')],
    has_more: false,
    limit: 100,
    page: 1,
  })
  vi.stubGlobal('location', { ...window.location, assign: api.assign })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('KnowledgeAgentAuthorizePage', () => {
  it('approves the chosen knowledge bases and returns to the agent', async () => {
    api.decide.mockResolvedValue({
      redirect_to: 'http://127.0.0.1:33418/callback?code=abc&state=state-1',
    })
    const user = userEvent.setup()
    renderWithConsoleQuery(<KnowledgeAgentAuthorizePage />)

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(api.describe).toHaveBeenCalledWith({ query: REQUEST })
    expect(screen.getByText('Acme')).toBeInTheDocument()
    const allow = screen.getByRole('button', { name: 'knowledgeSpace.agents.allow' })
    expect(allow).toBeDisabled()
    expect(await screen.findByRole('checkbox', { name: /Board/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await user.click(screen.getByRole('checkbox', { name: /Handbook/ }))
    await user.click(allow)

    await waitFor(() =>
      expect(api.decide).toHaveBeenCalledWith({
        body: { ...REQUEST, approve: true, knowledge_base_ids: ['kb-handbook'] },
      }),
    )
    await waitFor(() =>
      expect(api.assign).toHaveBeenCalledWith(
        'http://127.0.0.1:33418/callback?code=abc&state=state-1',
      ),
    )
  })

  it('denies without granting anything', async () => {
    api.decide.mockResolvedValue({
      redirect_to: 'http://127.0.0.1:33418/callback?error=access_denied',
    })
    const user = userEvent.setup()
    renderWithConsoleQuery(<KnowledgeAgentAuthorizePage />)

    await user.click(await screen.findByRole('button', { name: 'knowledgeSpace.agents.deny' }))

    await waitFor(() =>
      expect(api.decide).toHaveBeenCalledWith({
        body: { ...REQUEST, approve: false, knowledge_base_ids: [] },
      }),
    )
  })

  it('explains an invalid request instead of showing the consent form', async () => {
    api.describe.mockRejectedValue(
      createHttpError(new Response(null, { status: 422 }), {
        code: 'invalid_redirect_uri',
        message: 'redirect_uri is not registered for this client',
      }),
    )
    renderWithConsoleQuery(<KnowledgeAgentAuthorizePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('agents.authorizeInvalid')
    expect(screen.getByText('invalid_redirect_uri')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.agents.allow' }),
    ).not.toBeInTheDocument()
  })

  it('cannot approve while an admin has turned agent connections off', async () => {
    api.describe.mockResolvedValue(described({ agent_access_enabled: false }))
    renderWithConsoleQuery(<KnowledgeAgentAuthorizePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('agents.workspaceDisabled')
    expect(screen.getByRole('button', { name: 'knowledgeSpace.agents.allow' })).toBeDisabled()
  })
})
