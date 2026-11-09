import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowReferencesTable } from '../workflow-references-table'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.referencingWorkflows.get': request,
    }),
  }
})

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
    vi.resetAllMocks()
  })

  describe('Query contract', () => {
    it('should not fetch workflow references when disabled', () => {
      renderTable({ enabled: false })
      expect(request).not.toHaveBeenCalled()
      expect(
        screen.queryByText('agentV2.agentDetail.access.workflow.loading'),
      ).not.toBeInTheDocument()
    })
  })

  describe('Rendering', () => {
    it('should render workflow reference rows from the generated contract response', async () => {
      request.mockResolvedValueOnce({
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

      expect(await screen.findByRole('cell', { name: 'Support Workflow' })).toBeInTheDocument()
      expect(request).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: 'agent-1' } })
      expect(screen.getByText('v3')).toBeInTheDocument()
      expect(
        screen.getByText('agentV2.agentDetail.access.workflow.nodeCount:{"count":2}'),
      ).toBeInTheDocument()
      expect(screen.getByText('formatted-1781660000')).toBeInTheDocument()
      const studioLink = screen.getByRole('link', {
        name: 'agentV2.agentDetail.access.workflow.openInStudio Support Workflow',
      })
      expect(studioLink).toHaveAttribute('href', '/app/workflow-app-id/workflow')
      expect(studioLink).toHaveAttribute('target', '_blank')
      expect(studioLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render an empty state when the agent has no workflow references', async () => {
      request.mockResolvedValueOnce({ data: [] })

      renderTable()

      expect(
        await screen.findByText('agentV2.agentDetail.access.workflow.empty'),
      ).toBeInTheDocument()
    })

    it('should render a loading row while workflow references are pending', () => {
      request.mockReturnValueOnce(new Promise<never>(() => undefined))

      renderTable()

      expect(screen.getByText('agentV2.agentDetail.access.workflow.loading')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('should render a retry action when loading workflow references fails', async () => {
      const user = userEvent.setup()
      request.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ data: [] })

      renderTable()

      expect(
        await screen.findByText('agentV2.agentDetail.access.workflow.loadFailed'),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      expect(
        await screen.findByText('agentV2.agentDetail.access.workflow.empty'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('agentV2.agentDetail.access.workflow.loadFailed'),
      ).not.toBeInTheDocument()
      expect(request).toHaveBeenCalledTimes(2)
    })
  })
})
