import type {
  AgentLogConversationItemResponse,
  AgentLogMessageListResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { OnFeedback } from '@/app/components/base/chat/types'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentLogDetailPanel } from '../components/log-detail-panel'

const mocks = vi.hoisted(() => ({
  chatProps: vi.fn(),
  feedbackMutationFn: vi.fn(),
  messagesQueryFn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: ({
    chatList,
    config,
    onFeedback,
  }: {
    chatList: IChatItem[]
    config?: { supportFeedback?: boolean }
    onFeedback?: OnFeedback
  }) => {
    mocks.chatProps({ chatList, config, onFeedback })
    return (
      <button
        onClick={() => void onFeedback?.('message-1', { rating: 'like' }).catch(() => undefined)}
      >
        submit-feedback
      </button>
    )
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        feedbacks: {
          post: {
            mutationOptions: () => ({ mutationFn: mocks.feedbackMutationFn }),
          },
        },
        logs: {
          get: {
            key: () => ['agent-logs'],
          },
          byConversationId: {
            messages: {
              get: {
                key: () => ['agent-log-messages'],
                queryOptions: ({ input }: { input: unknown }) => ({
                  queryFn: () => mocks.messagesQueryFn(input),
                  queryKey: ['agent-log-messages', input],
                }),
              },
            },
          },
        },
      },
    },
  },
}))

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

function renderPanel(log: AgentLogConversationItemResponse, messages: AgentLogMessageListResponse) {
  mocks.messagesQueryFn.mockResolvedValue(messages)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

  render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AgentLogDetailPanel agentId="agent-1" log={log} onClose={vi.fn()} />
    </QueryClientTestProvider>,
  )

  return { invalidateQueries }
}

describe('AgentLogDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.feedbackMutationFn.mockResolvedValue({ result: 'success' })
  })

  it('maps user and admin feedback and submits operator feedback for webapp messages', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPanel(webappLog, webappMessages)

    await screen.findByRole('button', { name: 'submit-feedback' })
    expect(mocks.chatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ supportFeedback: true }),
        chatList: expect.arrayContaining([
          expect.objectContaining({
            adminFeedback: { content: 'Needs work', from_source: 'admin', rating: 'dislike' },
            feedback: { content: 'Helpful', from_source: 'user', rating: 'like' },
            feedbackDisabled: false,
            id: 'message-1',
          }),
        ]),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'submit-feedback' }))

    await waitFor(() => {
      expect(mocks.feedbackMutationFn.mock.calls[0]?.[0]).toEqual({
        body: {
          content: undefined,
          message_id: 'message-1',
          rating: 'like',
        },
        params: { agent_id: 'agent-1' },
      })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agent-logs'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agent-log-messages'] })
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('reports operator feedback failures without refreshing log queries', async () => {
    const user = userEvent.setup()
    mocks.feedbackMutationFn.mockRejectedValue(new Error('feedback request failed'))
    const { invalidateQueries } = renderPanel(webappLog, webappMessages)

    await user.click(await screen.findByRole('button', { name: 'submit-feedback' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(invalidateQueries).not.toHaveBeenCalled()
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

    await screen.findByRole('button', { name: 'submit-feedback' })
    expect(mocks.chatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ supportFeedback: false }),
        chatList: expect.arrayContaining([
          expect.objectContaining({ feedbackDisabled: true, id: 'message-1' }),
        ]),
      }),
    )
  })
})
