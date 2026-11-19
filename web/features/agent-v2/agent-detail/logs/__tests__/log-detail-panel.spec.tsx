import type {
  AgentLogConversationItemResponse,
  AgentLogMessageListResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { Drawer } from '@langgenius/dify-ui/drawer'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentLogDetailPanel } from '../components/log-detail-panel'

const mocks = vi.hoisted(() => ({
  feedbackMutationFn: vi.fn(),
  messagesQueryFn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (value: number) => `formatted-${value}`,
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.feedbacks.post': mocks.feedbackMutationFn,
      'agent.byAgentId.traceRuns.byMessageId.get': async () => ({ status: 'not_collected' }),
      'apps.byAppId.traceRuns.bySourceKind.bySourceId.get': async () => ({
        status: 'not_collected',
      }),
      'agent.byAgentId.logs.byConversationId.messages.get': mocks.messagesQueryFn,
    }),
  }
})

const webappLog: AgentLogConversationItemResponse = {
  conversation_id: 'conversation-1',
  id: 'conversation-1',
  message_count: 1,
  source: {
    app_id: 'app-1',
    app_name: 'Agent WebApp',
    id: 'webapp:app-1',
    type: 'webapp',
  },
  status: 'success',
  title: 'Feedback conversation',
  unread: false,
}

const workflowLog: AgentLogConversationItemResponse = {
  ...webappLog,
  conversation_id: 'execution-1',
  id: 'execution-1',
  source: {
    app_id: 'workflow-app-1',
    app_name: 'Workflow App',
    id: 'workflow:workflow-app-1:workflow-1:v1:node-1',
    node_id: 'node-1',
    type: 'workflow',
    workflow_id: 'workflow-1',
    workflow_version: 'v1',
  },
}

const webappMessages: AgentLogMessageListResponse = {
  data: [
    {
      answer: 'Answer',
      answer_tokens: 4,
      conversation_id: 'conversation-1',
      currency: 'USD',
      feedback_enabled: true,
      feedbacks: [
        { content: 'Helpful', from_source: 'user', rating: 'like' },
        { content: 'Needs work', from_source: 'admin', rating: 'dislike' },
      ],
      id: 'message-1',
      latency: 1.25,
      message_id: 'message-1',
      message_tokens: 3,
      query: 'Question',
      status: 'success',
      total_price: '0.001',
      total_tokens: 7,
    },
  ],
  has_more: false,
  limit: 100,
  page: 1,
  total: 1,
}

function renderPanel(
  log: AgentLogConversationItemResponse,
  messages: AgentLogMessageListResponse,
  refreshedMessages = messages,
) {
  mocks.messagesQueryFn.mockResolvedValueOnce(messages).mockResolvedValue(refreshedMessages)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Drawer open>
        <AgentLogDetailPanel agentId="agent-1" log={log} onClose={vi.fn()} />
      </Drawer>
    </QueryClientTestProvider>,
  )
}

describe('AgentLogDetailPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.feedbackMutationFn.mockResolvedValue({ result: 'success' })
  })

  it('maps user and admin feedback and removes operator feedback for webapp messages', async () => {
    const user = userEvent.setup()
    renderPanel(webappLog, webappMessages, {
      ...webappMessages,
      data: [
        {
          ...webappMessages.data[0]!,
          answer: 'Refreshed answer',
          feedbacks: webappMessages.data[0]!.feedbacks?.filter(
            (feedback) => feedback.from_source === 'user',
          ),
        },
      ],
    })

    expect(
      await screen.findByRole('img', {
        name: 'appLog.table.header.userRate: appLog.detail.operation.like - Helpful',
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'appLog.table.header.adminRate: appLog.detail.operation.dislike',
        pressed: true,
      }),
    )
    await waitFor(() => {
      expect(mocks.feedbackMutationFn).toHaveBeenLastCalledWith({
        body: {
          content: undefined,
          message_id: 'message-1',
          rating: null,
        },
        params: { agent_id: 'agent-1' },
      })
    })
    expect(await screen.findByText('Refreshed answer')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'appLog.table.header.adminRate: appLog.detail.operation.like',
        pressed: false,
      }),
    ).toBeInTheDocument()
  })

  it('reports operator feedback failures without refreshing log queries', async () => {
    const user = userEvent.setup()
    mocks.feedbackMutationFn.mockRejectedValue(new Error('feedback request failed'))
    renderPanel(webappLog, webappMessages)

    await user.click(
      await screen.findByRole('button', {
        name: 'appLog.table.header.adminRate: appLog.detail.operation.dislike',
        pressed: true,
      }),
    )

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('feedback request failed'))
    expect(
      screen.getByRole('button', {
        name: 'appLog.table.header.adminRate: appLog.detail.operation.dislike',
        pressed: true,
      }),
    ).toBeInTheDocument()
    expect(mocks.messagesQueryFn).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('keeps feedback disabled for workflow execution messages', async () => {
    renderPanel(workflowLog, {
      ...webappMessages,
      data: [
        {
          ...webappMessages.data[0]!,
          conversation_id: 'execution-1',
          feedback_enabled: false,
          feedbacks: [],
        },
      ],
    })

    expect(await screen.findByText('Question')).toBeInTheDocument()
    expect(screen.getByText('Answer')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /appLog.table.header.(adminRate|userRate)/ }),
    ).not.toBeInTheDocument()
    expect(mocks.feedbackMutationFn).not.toHaveBeenCalled()
  })
})
