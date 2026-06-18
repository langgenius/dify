import type { ComponentProps } from 'react'
import type { AgentRosterListItem } from '../agent-roster-list'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentRosterList } from '../agent-roster-list'

const { duplicateAgentMutationFn } = vi.hoisted(() => ({
  duplicateAgentMutationFn: vi.fn(),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '06/12/2026 12:00:00 PM',
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        copy: {
          post: {
            mutationOptions: () => ({
              mutationFn: duplicateAgentMutationFn,
            }),
          },
        },
        delete: {
          mutationOptions: () => ({
            mutationFn: vi.fn(),
          }),
        },
        put: {
          mutationOptions: () => ({
            mutationFn: vi.fn(),
          }),
        },
      },
    },
  },
}))

const createAgent = (overrides: Partial<AgentRosterListItem> = {}): AgentRosterListItem => ({
  active_config_is_published: false,
  description: 'Find and summarize market materials.',
  id: 'agent-1',
  icon_url: null,
  mode: 'agent',
  name: 'Research Agent',
  published_reference_count: 0,
  published_references: [],
  role: 'Research Assistant',
  ...overrides,
})

const renderList = (
  agents: AgentRosterListItem[],
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
    vi.spyOn(toast, 'error').mockReturnValue('toast-id')
    vi.spyOn(toast, 'success').mockReturnValue('toast-id')
    duplicateAgentMutationFn.mockResolvedValue(createAgent({
      id: 'agent-copy',
      name: 'Research Agent copy',
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders role under the card title instead of the agent mode', () => {
    renderList([createAgent()])

    expect(screen.getByText('Research Assistant')).toBeInTheDocument()
    expect(screen.queryByText('agent')).not.toBeInTheDocument()
  })

  it('uses the Figma-aligned card title and role typography', () => {
    renderList([createAgent()])

    expect(screen.getByRole('heading', { name: 'Research Agent' })).toHaveClass('system-md-semibold')
    expect(screen.getByText('Research Assistant')).toHaveClass('system-xs-regular')
    expect(screen.getByText('agentV2.roster.usageStatus.draft')).toHaveClass('system-2xs-medium-uppercase')
  })

  it('draws the primary link focus ring above the draft corner label without z-index', () => {
    renderList([createAgent()])

    const configureLink = screen.getByRole('link', { name: 'Research Agent' })
    const draftLabel = screen.getByText('agentV2.roster.usageStatus.draft')
    const draftCornerLabel = draftLabel.closest('.absolute')

    expect(configureLink).toHaveClass(
      'relative',
      'focus-visible:after:ring-2',
      'focus-visible:after:ring-state-accent-solid',
      'focus-visible:after:ring-inset',
    )
    expect(configureLink).not.toHaveClass('peer/card-link')
    expect(draftCornerLabel && configureLink.contains(draftCornerLabel)).toBe(true)
    expect(draftCornerLabel).toHaveClass(
      'top-[-0.5px]',
      'right-0',
    )
    expect(draftCornerLabel).not.toHaveClass('z-10', 'z-20')
  })

  it('only renders the draft badge for unpublished agents', () => {
    renderList([
      createAgent({
        active_config_is_published: true,
        id: 'agent-published',
        name: 'Published Agent',
        published_reference_count: 1,
      }),
      createAgent({
        id: 'agent-draft',
        name: 'Draft Agent',
        published_reference_count: 0,
      }),
    ])

    expect(screen.getByText('agentV2.roster.usageStatus.draft')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Published Agent' })).toBeInTheDocument()
    expect(screen.queryByText('agentV2.roster.usageStatus.inUse')).not.toBeInTheDocument()
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

  it('uses the same overlay treatment for loading errors', () => {
    const { container } = renderList([], { isError: true })

    expect(screen.getByRole('heading', { name: 'agentV2.roster.loadingError' })).toHaveClass('system-sm-regular', 'text-text-tertiary')
    expect(container.querySelectorAll('.bg-background-default-lighter')).toHaveLength(16)
    expect(container.querySelector('.bg-linear-to-b')).toBeInTheDocument()
  })

  it('opens published workflow references from the card reference trigger', async () => {
    const user = userEvent.setup()
    renderList([
      createAgent({
        published_reference_count: 1,
        published_references: [
          {
            app_id: 'workflow-app-id',
            app_icon: '🐍',
            app_icon_background: '#E9F8D8',
            app_icon_type: 'emoji',
            app_name: 'RFP Review Flow',
          },
        ],
      }),
    ])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.references\.trigger/ }))

    const workflowLink = screen.getByRole('menuitem', { name: /RFP Review Flow/ })
    expect(workflowLink).toHaveAttribute('href', '/app/workflow-app-id/workflow')
    expect(screen.getByText(/agentV2\.roster\.references\.label/)).toBeInTheDocument()
  })

  it('duplicates an agent from the card action menu', async () => {
    const user = userEvent.setup()
    renderList([createAgent()])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.duplicate/ }))

    expect(duplicateAgentMutationFn).toHaveBeenCalledWith(
      {
        params: {
          agent_id: 'agent-1',
        },
        body: {},
      },
      expect.objectContaining({
        client: expect.any(QueryClient),
      }),
    )
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('agentV2.roster.duplicateSuccess')
    })
  })
})
