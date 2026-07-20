import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowReferencesTable } from '../workflow-references-table'

const mocks = vi.hoisted(() => ({
  queryFn: vi.fn(),
  queryOptions: vi.fn(({ enabled = true, input }: { enabled?: boolean; input: unknown }) => ({
    queryKey: ['agent-referencing-workflows', input],
    queryFn: () => mocks.queryFn(input),
    enabled,
  })),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        referencingWorkflows: {
          get: {
            queryOptions: mocks.queryOptions,
          },
        },
      },
    },
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (value: number) => `formatted-${value}`,
  }),
}))

const renderTable = ({ enabled }: { enabled?: boolean } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <WorkflowReferencesTable agentId="agent-1" enabled={enabled} />
    </QueryClientProvider>,
  )

  return queryClient
}

describe('WorkflowReferencesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Query contract', () => {
    it('should request workflow references for the current agent', async () => {
      mocks.queryFn.mockResolvedValueOnce({ data: [] })

      renderTable()

      await waitFor(() => {
        expect(mocks.queryOptions).toHaveBeenCalledWith({
          input: {
            params: {
              agent_id: 'agent-1',
            },
          },
          enabled: true,
        })
      })
    })

    it('should not fetch workflow references when disabled', async () => {
      renderTable({ enabled: false })

      await waitFor(() => {
        expect(mocks.queryOptions).toHaveBeenCalledWith({
          input: {
            params: {
              agent_id: 'agent-1',
            },
          },
          enabled: false,
        })
      })
      expect(mocks.queryFn).not.toHaveBeenCalled()
      expect(
        screen.queryByText('agentV2.agentDetail.access.workflow.loading'),
      ).not.toBeInTheDocument()
    })
  })

  describe('Rendering', () => {
    it('should render workflow reference rows from the generated contract response', async () => {
      mocks.queryFn.mockResolvedValueOnce({
        data: [
          {
            app_icon: 'A',
            app_icon_background: '#E0F2FE',
            app_icon_type: 'emoji',
            app_id: 'workflow-app-id',
            app_mode: 'workflow',
            app_name: 'Support Workflow',
            app_updated_at: 1781660000,
            node_ids: ['agent-node-a', 'agent-node-b'],
            workflow_id: 'workflow-id',
            workflow_version: 'v3',
          },
        ],
      })

      renderTable()

      expect(await screen.findByText('Support Workflow')).toBeInTheDocument()
      expect(screen.getByText('v3')).toBeInTheDocument()
      expect(
        screen.getByText('agentV2.agentDetail.access.workflow.nodeCount:{"count":2}'),
      ).toBeInTheDocument()
      expect(screen.getByText('formatted-1781660000')).toBeInTheDocument()
      const studioLink = screen.getByRole('link', {
        name: 'agentV2.agentDetail.access.workflow.openInStudioFor:{"name":"Support Workflow"}',
      })
      expect(studioLink).toHaveAttribute('href', '/app/workflow-app-id/workflow')
      expect(studioLink).toHaveAttribute('target', '_blank')
      expect(studioLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render an empty state when the agent has no workflow references', async () => {
      mocks.queryFn.mockResolvedValueOnce({ data: [] })

      renderTable()

      expect(
        await screen.findByText('agentV2.agentDetail.access.workflow.empty'),
      ).toBeInTheDocument()
    })

    it('should render a loading row while workflow references are pending', () => {
      mocks.queryFn.mockReturnValueOnce(new Promise<never>(() => undefined))

      renderTable()

      expect(screen.getByText('agentV2.agentDetail.access.workflow.loading')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('should render a retry action when loading workflow references fails', async () => {
      const user = userEvent.setup()
      mocks.queryFn.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ data: [] })

      renderTable()

      expect(
        await screen.findByText('agentV2.agentDetail.access.workflow.loadFailed'),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      await waitFor(() => {
        expect(mocks.queryFn).toHaveBeenCalledTimes(2)
      })
    })
  })
})
