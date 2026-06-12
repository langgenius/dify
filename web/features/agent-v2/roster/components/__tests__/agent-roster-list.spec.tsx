import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { AgentRosterList } from '../agent-roster-list'

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '06/12/2026 12:00:00 PM',
  }),
}))

const createAgent = (overrides: Partial<AgentRosterResponse> = {}): AgentRosterResponse => ({
  agent_kind: 'dify_agent',
  description: 'Find and summarize market materials.',
  id: 'agent-1',
  name: 'Research Agent',
  published_node_reference_count: 0,
  published_reference_count: 0,
  published_references: [],
  role: 'Researcher',
  scope: 'roster',
  source: 'agent_app',
  status: 'active',
  ...overrides,
})

const renderList = (agents: AgentRosterResponse[]) => {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentRosterList
        agents={agents}
        hasMore={false}
        isEmptySearch={false}
        isError={false}
        isFetching={false}
        isFetchingNextPage={false}
        isPending={false}
        label="Agent roster list"
        onLoadMore={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('AgentRosterList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders role under the card title instead of the agent source', () => {
    renderList([createAgent()])

    expect(screen.getByText('Researcher')).toBeInTheDocument()
    expect(screen.queryByText('agentV2.roster.sources.agent_app')).not.toBeInTheDocument()
  })

  it('derives the card badge from published reference count', () => {
    renderList([
      createAgent({
        id: 'agent-in-use',
        name: 'Research Agent',
        published_reference_count: 1,
      }),
      createAgent({
        id: 'agent-draft',
        name: 'Draft Agent',
        published_reference_count: 0,
      }),
    ])

    expect(screen.getByText('agentV2.roster.usageStatus.inUse')).toBeInTheDocument()
    expect(screen.getByText('agentV2.roster.usageStatus.draft')).toBeInTheDocument()
    expect(screen.queryByText('agentV2.roster.status.active')).not.toBeInTheDocument()
  })
})
