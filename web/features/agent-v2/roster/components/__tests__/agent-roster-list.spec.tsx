import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const renderList = (
  agents: AgentRosterResponse[],
  overrides: Partial<ComponentProps<typeof AgentRosterList>> = {},
) => {
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
        {...overrides}
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

  it('uses the Figma-aligned card title and role typography', () => {
    renderList([createAgent()])

    expect(screen.getByRole('heading', { name: 'Research Agent' })).toHaveClass('system-md-semibold')
    expect(screen.getByText('Researcher')).toHaveClass('system-xs-regular')
    expect(screen.getByText('agentV2.roster.usageStatus.draft')).toHaveClass('system-2xs-medium-uppercase')
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

  it('renders the Figma-aligned empty roster overlay', () => {
    const { container } = renderList([])

    expect(screen.getByRole('heading', { name: 'agentV2.roster.empty' })).toHaveClass('system-sm-regular', 'text-text-tertiary')
    expect(container.querySelectorAll('.bg-background-default-lighter')).toHaveLength(16)
    expect(container.querySelector('.bg-linear-to-b')).toBeInTheDocument()
    expect(container.querySelector('.i-ri-robot-2-line')).toHaveClass('size-6', 'text-text-tertiary')
  })

  it('uses the same overlay treatment for empty search results', () => {
    const { container } = renderList([], { isEmptySearch: true })

    expect(screen.getByRole('heading', { name: 'agentV2.roster.emptySearch' })).toBeInTheDocument()
    expect(container.querySelectorAll('.bg-background-default-lighter')).toHaveLength(16)
    expect(screen.queryByText('agentV2.roster.emptySearchDescription')).not.toBeInTheDocument()
  })

  it('opens published workflow references from the card reference trigger', async () => {
    const user = userEvent.setup()
    renderList([
      createAgent({
        published_reference_count: 1,
        published_references: [
          {
            app_id: 'workflow-app-id',
            app_mode: 'workflow',
            app_name: 'RFP Review Flow',
            node_ids: ['agent-node-a'],
            workflow_id: 'published-workflow-id',
            workflow_version: '2026-06-12 10:00:00',
          },
        ],
      }),
    ])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.references\.trigger/ }))

    const workflowLink = screen.getByRole('menuitem', { name: /RFP Review Flow/ })
    expect(workflowLink).toHaveAttribute('href', '/app/workflow-app-id/workflow')
    expect(screen.getByText(/agentV2\.roster\.references\.label/)).toBeInTheDocument()
  })
})
