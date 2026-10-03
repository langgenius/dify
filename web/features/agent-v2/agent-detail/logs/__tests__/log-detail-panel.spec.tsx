import type {
  AgentLogConversationItemResponse,
  AgentLogMessageListResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ChatProps } from '@/app/components/base/chat/chat'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { OnFeedback } from '@/app/components/base/chat/types'
import { Drawer } from '@langgenius/dify-ui/drawer'
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
    renderAgentContent,
  }: {
    chatList: IChatItem[]
    config?: { supportFeedback?: boolean }
    onFeedback?: OnFeedback
    renderAgentContent?: ChatProps['renderAgentContent']
  }) => {
    mocks.chatProps({ chatList, config, onFeedback, renderAgentContent })
    return (
      <button
        onClick={() => void onFeedback?.('message-1', { rating: 'like' }).catch(() => undefined)}
      >
        submit-feedback
      </button>
    )
  },
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

vi.mock('@/service/console', () => ({
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

const thoughtMessages: AgentLogMessageListResponse = {
  ...webappMessages,
  data: [
    {
      ...webappMessages.data[0]!,
      agent_thoughts: [
        {
          id: 'tool-1',
          message_id: 'message-1',
          position: 2,
          thought: 'Inspect the workspace',
          answer: 'Progress update',
          tool: 'shell_run',
          tool_input: 'ls /workspace',
          observation: 'report.txt',
          tool_labels: { shell_run: { en_US: 'List workspace', zh_Hans: '列出工作区' } },
          files: ['tool-file'],
        },
        {
          id: 'thought-1',
          message_id: 'message-1',
          position: 1,
          thought: '# Plan the response',
          tool_labels: null,
          files: [],
        },
      ],
      message_files: [
        {
          id: 'input-file',
          filename: 'brief.txt',
          belongs_to: 'user',
          type: 'document',
          transfer_method: 'local_file',
          url: '/files/brief',
          mime_type: 'text/plain',
        },
        {
          id: 'tool-file',
          filename: 'report.txt',
          belongs_to: 'assistant',
          type: 'document',
          transfer_method: 'tool_file',
          url: '/files/report',
          mime_type: 'text/plain',
        },
      ],
    },
  ],
}

function renderPanel(log: AgentLogConversationItemResponse, messages: AgentLogMessageListResponse) {
  mocks.messagesQueryFn.mockResolvedValue(messages)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

  render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Drawer open>
        <AgentLogDetailPanel agentId="agent-1" log={log} onClose={vi.fn()} />
      </Drawer>
    </QueryClientTestProvider>,
  )

  return { invalidateQueries }
}

describe('AgentLogDetailPanel', () => {
  // Markdown reaches the DOM through next/dynamic; warm the chunk so lazy
  // resolution does not race the thought assertions.
  beforeAll(async () => {
    await import('@/app/components/base/markdown/streamdown-wrapper')
  })

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

  it('maps persisted thoughts and attachments onto the answer chat item', async () => {
    renderPanel(webappLog, thoughtMessages)

    await screen.findByRole('button', { name: 'submit-feedback' })

    const { chatList } = mocks.chatProps.mock.calls.at(-1)![0]
    const [question, answer] = chatList as IChatItem[]
    expect(question?.message_files?.map((file) => file.name)).toEqual(['brief.txt'])
    expect(answer?.agent_thoughts?.map((thought) => thought.id)).toEqual(['thought-1', 'tool-1'])
    expect(answer?.agent_thoughts?.[1]?.tool_labels).toEqual({
      shell_run: { en_US: 'List workspace', zh_Hans: '列出工作区' },
    })
    expect(answer?.message_files?.map((file) => file.name)).toEqual(['report.txt'])
  })

  it('renders persisted thoughts through the agent content renderer', async () => {
    const user = userEvent.setup()
    renderPanel(webappLog, thoughtMessages)
    await screen.findByRole('button', { name: 'submit-feedback' })

    const { chatList, renderAgentContent } = mocks.chatProps.mock.calls.at(-1)![0]
    const answer = (chatList as IChatItem[]).find((item) => item.isAnswer)!
    render(<>{renderAgentContent?.({ item: answer, content: answer.content })}</>)

    const toggle = screen.getByRole('button', { name: /thinking/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Inspect the workspace')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(
      await screen.findByRole(
        'heading',
        { name: 'Plan the response', level: 1 },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Inspect the workspace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /List workspace/ })).toBeInTheDocument()
  })
})
