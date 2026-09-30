import type { ReactNode } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { render } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'
import ConversationList from '../list'

const mockFetchChatMessages = vi.fn()
const mockUpdateLogMessageFeedbacks = vi.fn()
const mockUpdateLogMessageAnnotations = vi.fn()
const mockOnRefresh = vi.fn()
const mockCompletionRefetch = vi.fn()
const mockDelAnnotation = vi.fn()

let mockChatConversationDetail: Record<string, unknown> | undefined
let mockCompletionConversationDetail: Record<string, unknown> | undefined
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
  },
}))

vi.mock('@/service/use-log', () => ({
  useChatConversationDetail: () => ({
    data: mockChatConversationDetail,
  }),
  useCompletionConversationDetail: () => ({
    data: mockCompletionConversationDetail,
    refetch: mockCompletionRefetch,
  }),
}))

vi.mock('@/service/log', () => ({
  fetchChatMessages: (...args: unknown[]) => mockFetchChatMessages(...args),
  updateLogMessageFeedbacks: (...args: unknown[]) => mockUpdateLogMessageFeedbacks(...args),
  updateLogMessageAnnotations: (...args: unknown[]) => mockUpdateLogMessageAnnotations(...args),
}))

vi.mock('@/service/annotation', () => ({
  delAnnotation: (...args: unknown[]) => mockDelAnnotation(...args),
}))

vi.mock('@/app/components/base/loading-placeholder', () => ({
  LoadingPlaceholder: () => <div>loading</div>,
}))

vi.mock('@/app/components/app/log/model-info', () => ({
  default: ({ model }: { model: string }) => <div data-testid="model-info">{model}</div>,
}))

vi.mock('@/app/components/app/log/var-panel', () => ({
  default: ({ varList }: { varList: Array<{ label: string; value: string }> }) => (
    <div data-testid="var-panel">
      {varList.map((item) => `${item.label}:${item.value}`).join(',')}
    </div>
  ),
}))

vi.mock('@/app/components/base/copy-icon', () => ({
  default: ({ content }: { content: string }) => <div data-testid="copy-icon">{content}</div>,
}))

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: ({
    content,
    onOpenLog,
    onFeedback,
  }: {
    content: string
    onOpenLog?: (item: IChatItem) => void
    onFeedback: (value: { rating: string; content?: string }) => Promise<boolean>
  }) => (
    <div data-testid="text-generation" data-log-enabled={String(!!onOpenLog)}>
      <div>{content}</div>
      <button onClick={() => void onFeedback({ rating: 'like', content: 'great' })}>
        completion-feedback
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: ({
    chatList,
    onFeedback,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    switchSibling,
    onOpenLog,
  }: {
    chatList: Array<{ id: string }>
    onFeedback: (mid: string, value: { rating: string; content?: string }) => Promise<boolean>
    onAnnotationAdded: (
      annotationId: string,
      authorName: string,
      query: string,
      answer: string,
      index: number,
    ) => void
    onAnnotationEdited: (query: string, answer: string, index: number) => void
    onAnnotationRemoved: (index: number) => Promise<boolean>
    switchSibling: (siblingMessageId: string) => void
    onOpenLog?: (item: IChatItem) => void
  }) => (
    <div data-testid="chat-panel" data-log-enabled={String(!!onOpenLog)}>
      <div>{chatList.length}</div>
      {onOpenLog && (
        <>
          <button
            onClick={() =>
              onOpenLog({
                id: 'log-1',
                content: 'answer',
                isAnswer: true,
                workflow_run_id: 'run-1',
                agent_thoughts: [
                  {
                    id: 'thought',
                    tool: '',
                    thought: 'thinking',
                    tool_input: '',
                    message_id: 'log',
                    conversation_id: 'conversation-1',
                    observation: '',
                    position: 0,
                  },
                ],
                log: [],
              })
            }
          >
            open-workflow-log
          </button>
          <button
            onClick={() =>
              onOpenLog({
                id: 'log-2',
                content: 'answer',
                isAnswer: true,
                agent_thoughts: [
                  {
                    id: 'thought',
                    tool: '',
                    thought: 'thinking',
                    tool_input: '',
                    message_id: 'log',
                    conversation_id: 'conversation-1',
                    observation: '',
                    position: 0,
                  },
                ],
                log: [],
              })
            }
          >
            open-agent-log
          </button>
          <button
            onClick={() =>
              onOpenLog({
                id: 'log-3',
                content: 'answer',
                isAnswer: true,
                log: [{ role: 'user', text: 'prompt' }],
              })
            }
          >
            open-prompt-log
          </button>
          <button onClick={() => onOpenLog({ id: 'log-4', content: 'answer', isAnswer: true })}>
            open-no-log
          </button>
        </>
      )}
      <button onClick={() => void onFeedback('message-1', { rating: 'like', content: 'nice' })}>
        chat-feedback
      </button>
      <button
        onClick={() =>
          onAnnotationAdded('annotation-2', 'Admin', 'Edited question', 'Edited answer', 1)
        }
      >
        chat-add-annotation
      </button>
      <button onClick={() => onAnnotationEdited('Updated question', 'Updated answer', 1)}>
        chat-edit-annotation
      </button>
      <button onClick={() => void onAnnotationRemoved(1)}>chat-remove-annotation</button>
      <button onClick={() => switchSibling('message-2')}>chat-switch-sibling</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/agent-log-modal', () => ({
  default: ({ floating, onCancel }: { floating?: boolean; onCancel: () => void }) => (
    <div data-testid="agent-log-modal" data-floating={String(floating)}>
      <button onClick={onCancel}>close-agent-log-modal</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/message-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="message-log-modal">
      <button onClick={onCancel}>close-message-log-modal</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/prompt-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="prompt-log-modal">
      <button onClick={onCancel}>close-prompt-log-modal</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const createLogs = () => ({
  data: [
    {
      id: 'conversation-1',
      name: 'hello world',
      from_account_name: 'demo-user',
      read_at: null,
      message_count: 2,
      user_feedback_stats: { like: 0, dislike: 0 },
      admin_feedback_stats: { like: 0, dislike: 0 },
      updated_at: 1710000000,
      created_at: 1710000000,
      annotated: false,
    },
  ],
})

const createCompletionLogs = () => ({
  data: [
    {
      id: 'conversation-1',
      from_account_name: 'demo-user',
      read_at: null,
      user_feedback_stats: { like: 0, dislike: 0 },
      admin_feedback_stats: { like: 0, dislike: 0 },
      updated_at: 1710000000,
      created_at: 1710000000,
      message: {
        inputs: {
          query: 'Question',
        },
        answer: 'Answer',
      },
      annotation: {
        content: 'Annotated answer',
        account: {
          name: 'Admin',
        },
        created_at: 1710000100,
      },
    },
  ],
})

const createChatMessage = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  answer: `Assistant reply ${id}`,
  query: `Question ${id}`,
  created_at: 1710000000,
  inputs: {
    query: `Question ${id}`,
  },
  feedbacks: [],
  message: [],
  message_files: [],
  answer_tokens: 10,
  message_tokens: 5,
  parent_message_id: undefined,
  ...overrides,
})

const renderConversationList = ({
  appDetail = { id: 'app-1', mode: AppModeEnum.CHAT } as any,
  logs = createLogs() as any,
  searchParams = '?page=2',
}: {
  appDetail?: any
  logs?: any
  searchParams?: string
} = {}) => {
  const queryClient = createAccountProfileQueryClient({ timezone: 'Asia/Shanghai' })
  return renderWithNuqs(
    <QueryClientTestProvider queryClient={queryClient}>
      <ConversationList appDetail={appDetail} logs={logs} onRefresh={mockOnRefresh} />
    </QueryClientTestProvider>,
    { searchParams },
  )
}

describe('ConversationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatConversationDetail = undefined
    mockCompletionConversationDetail = undefined
    mockDelAnnotation.mockResolvedValue(undefined)
    mockFetchChatMessages.mockResolvedValue({
      data: [],
      has_more: false,
    })
  })

  it('should render chat rows and push the conversation id into the url when a row is clicked', async () => {
    const { onUrlUpdate } = renderConversationList()

    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(screen.getAllByText('formatted-1710000000')).toHaveLength(2)

    fireEvent.click(screen.getByText('hello world'))

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled()
      expect(screen.getByRole('dialog', { name: 'appLog.runDetail.title' })).toBeInTheDocument()
    })

    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(update.searchParams.get('page')).toBe('2')
    expect(update.searchParams.get('conversation_id')).toBe('conversation-1')
    expect(update.options.history).toBe('push')
  })

  it('exposes the unread marker only for unread conversations', () => {
    const unreadLog = createLogs().data[0]
    renderConversationList({
      logs: {
        data: [
          unreadLog,
          { ...unreadLog, id: 'conversation-2', name: 'read conversation', read_at: 1710000100 },
        ],
      },
    })

    const unreadRow = screen.getByRole('row', { name: /hello world/ })
    const readRow = screen.getByRole('row', { name: /read conversation/ })
    expect(within(unreadRow).getByText('appLog.table.unread')).toBeInTheDocument()
    expect(within(readRow).queryByText('appLog.table.unread')).not.toBeInTheDocument()
  })

  it.each(['keyboard', 'row'])(
    'restores focus to the conversation entry after %s opening',
    async (opening) => {
      const user = userEvent.setup()
      const { onUrlUpdate } = renderConversationList()
      const trigger = screen.getByRole('button', { name: 'formatted-1710000000' })
      if (opening === 'keyboard') {
        trigger.focus()
        await user.keyboard('{Enter}')
      } else {
        await user.click(screen.getByText('hello world'))
      }
      await screen.findByRole('dialog')
      await waitFor(() => {
        expect(onUrlUpdate.mock.calls.at(-1)![0].searchParams.get('conversation_id')).toBe(
          'conversation-1',
        )
      })
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
      })
      expect(mockOnRefresh).toHaveBeenCalledTimes(1)
      expect(onUrlUpdate.mock.calls.at(-1)![0].searchParams.has('conversation_id')).toBe(false)
    },
  )

  it('should close the drawer and refresh', async () => {
    mockChatConversationDetail = {
      id: 'conversation-1',
      created_at: 1710000000,
      model_config: {
        model: 'gpt-4o',
        configs: {
          introduction: 'Hello there',
        },
        user_input_form: [],
      },
      message: {
        inputs: {},
      },
    }

    const { onUrlUpdate } = renderConversationList({
      searchParams: '?page=2&conversation_id=conversation-1',
    })

    expect(
      await screen.findByRole('dialog', { name: 'appLog.detail.conversationId' }),
    ).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /(?:^|\.)operation\.close(?=$|:)/ }))

    expect(mockOnRefresh).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled()
    })

    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(update.searchParams.get('page')).toBe('2')
    expect(update.searchParams.has('conversation_id')).toBe(false)
    expect(update.options.history).toBe('replace')
  })

  it('should render chat conversation details and submit feedback from the chat panel', async () => {
    mockChatConversationDetail = {
      id: 'conversation-1',
      created_at: 1710000000,
      model_config: {
        model: 'gpt-4o',
        configs: {
          introduction: 'Hello there',
        },
        user_input_form: [
          {
            query: {
              variable: 'query',
            },
          },
        ],
      },
      message: {
        inputs: {
          query: 'Latest question',
        },
      },
    }
    mockFetchChatMessages.mockResolvedValue({
      data: [
        {
          id: 'message-1',
          answer: 'Assistant reply',
          query: 'Latest question',
          created_at: 1710000000,
          inputs: {
            query: 'Latest question',
          },
          feedbacks: [],
          message: [],
          message_files: [],
        },
      ],
      has_more: false,
    })

    renderConversationList({
      searchParams: '?page=2&conversation_id=conversation-1',
    })

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalledWith({
        url: '/apps/app-1/chat-messages',
        params: {
          conversation_id: 'conversation-1',
          limit: 10,
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    })

    expect(screen.getByTestId('var-panel')).toHaveTextContent('query:Latest question')
    expect(screen.getByTestId('model-info')).toHaveTextContent('gpt-4o')

    fireEvent.click(screen.getByText('chat-feedback'))

    await waitFor(() => {
      expect(mockUpdateLogMessageFeedbacks).toHaveBeenCalledWith({
        url: '/apps/app-1/feedbacks',
        body: {
          message_id: 'message-1',
          rating: 'like',
          content: 'nice',
        },
      })
    })
  })

  it.each([
    ['chatbot', AppModeEnum.CHAT, 'false'],
    ['agent', AppModeEnum.AGENT_CHAT, 'false'],
    ['chatflow', AppModeEnum.ADVANCED_CHAT, 'true'],
  ])('should expose run details only for %s conversation answers', async (_, mode, expected) => {
    mockChatConversationDetail = {
      id: 'conversation-1',
      created_at: 1710000000,
      model_config: {
        model: 'gpt-4o',
        configs: {
          introduction: 'Hello there',
        },
        user_input_form: [],
      },
      message: {
        inputs: {},
      },
    }
    mockFetchChatMessages.mockResolvedValue({
      data: [createChatMessage('message-1')],
      has_more: false,
    })

    renderConversationList({
      appDetail: { id: 'app-1', mode } as any,
      searchParams: '?conversation_id=conversation-1',
    })

    expect(await screen.findByTestId('chat-panel')).toHaveAttribute('data-log-enabled', expected)
  })

  it('should render completion details and refetch after feedback updates', async () => {
    mockCompletionConversationDetail = {
      id: 'conversation-1',
      created_at: 1710000000,
      model_config: {
        model: 'gpt-4o-mini',
        user_input_form: [
          {
            query: {
              variable: 'query',
            },
          },
        ],
      },
      message: {
        id: 'message-1',
        answer: 'Generated output',
        inputs: {
          query: 'Question',
        },
        feedbacks: [],
        message_files: [{ url: 'https://example.com/file.txt' }],
      },
    }

    renderConversationList({
      appDetail: { id: 'app-1', mode: AppModeEnum.COMPLETION } as any,
      logs: createCompletionLogs() as any,
      searchParams: '?page=2&conversation_id=conversation-1',
    })

    await waitFor(() => {
      expect(screen.getByTestId('text-generation')).toBeInTheDocument()
    })

    expect(screen.getByTestId('var-panel')).toHaveTextContent('query:Question')
    expect(screen.getByTestId('text-generation')).toHaveAttribute('data-log-enabled', 'false')
    expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('completion-feedback'))

    await waitFor(() => {
      expect(mockUpdateLogMessageFeedbacks).toHaveBeenCalledWith({
        url: '/apps/app-1/feedbacks',
        body: {
          message_id: 'message-1',
          rating: 'like',
          content: 'great',
        },
      })
      expect(mockCompletionRefetch).toHaveBeenCalled()
    })
  })

  it('should render chatflow status cells and feedback counters for advanced chat logs', () => {
    renderConversationList({
      appDetail: { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT } as any,
      logs: {
        data: [
          {
            id: 'conversation-pending',
            name: 'Pending row',
            from_account_name: 'user-a',
            read_at: 1710000001,
            message_count: 3,
            status_count: { paused: 1, success: 0, failed: 0, partial_success: 0 },
            user_feedback_stats: { like: 2, dislike: 0 },
            admin_feedback_stats: { like: 0, dislike: 1 },
            updated_at: 1710000000,
            created_at: 1710000000,
          },
          {
            id: 'conversation-success',
            name: 'Success row',
            from_account_name: 'user-b',
            read_at: 1710000001,
            message_count: 4,
            status_count: { paused: 0, success: 4, failed: 0, partial_success: 0 },
            user_feedback_stats: { like: 0, dislike: 0 },
            admin_feedback_stats: { like: 0, dislike: 0 },
            updated_at: 1710000000,
            created_at: 1710000000,
          },
          {
            id: 'conversation-partial',
            name: 'Partial row',
            from_account_name: 'user-c',
            read_at: 1710000001,
            message_count: 5,
            status_count: { paused: 0, success: 3, failed: 0, partial_success: 1 },
            user_feedback_stats: { like: 0, dislike: 0 },
            admin_feedback_stats: { like: 0, dislike: 0 },
            updated_at: 1710000000,
            created_at: 1710000000,
          },
          {
            id: 'conversation-failure',
            name: 'Failure row',
            from_account_name: 'user-d',
            read_at: 1710000001,
            message_count: 1,
            status_count: { paused: 0, success: 0, failed: 2, partial_success: 0 },
            user_feedback_stats: { like: 0, dislike: 0 },
            admin_feedback_stats: { like: 0, dislike: 0 },
            updated_at: 1710000000,
            created_at: 1710000000,
          },
        ],
      } as any,
    })

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('Partial Success')).toBeInTheDocument()
    expect(screen.getByText('2 Failures')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  it('should support annotation changes and paginated scroll loading in the detail drawer', async () => {
    mockChatConversationDetail = {
      id: 'conversation-1',
      created_at: 1710000000,
      model_config: {
        model: 'gpt-4o',
        configs: {
          introduction: 'Hello there',
        },
        user_input_form: [
          {
            query: {
              variable: 'query',
            },
          },
        ],
      },
      message: {
        inputs: {
          query: 'Latest question',
        },
      },
    }
    mockFetchChatMessages
      .mockResolvedValueOnce({
        data: [
          createChatMessage('message-1', {
            annotation: {
              id: 'annotation-1',
              content: 'Annotated answer',
              account: { name: 'Admin' },
            },
          }),
          createChatMessage('message-2', { parent_message_id: 'message-1' }),
          createChatMessage('message-3', { parent_message_id: 'message-2' }),
          createChatMessage('message-4', { parent_message_id: 'message-3' }),
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [createChatMessage('message-5')],
        has_more: false,
      })

    renderConversationList({
      searchParams: '?page=2&conversation_id=conversation-1',
    })

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
      expect(screen.getByTestId('chat-panel')).toHaveTextContent('8')
      expect(screen.getByText(/(?:^|\.)detail\.loading\.\.\.(?=$|:)/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('chat-add-annotation'))
    fireEvent.click(screen.getByText('chat-edit-annotation'))
    fireEvent.click(screen.getByText('chat-remove-annotation'))

    await waitFor(() => {
      expect(mockDelAnnotation).toHaveBeenCalledWith('app-1', 'annotation-2')
    })

    const scrollableDiv = document.getElementById('scrollableDiv') as HTMLDivElement
    Object.defineProperty(scrollableDiv, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(scrollableDiv, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(scrollableDiv, 'scrollTop', { configurable: true, value: -400 })

    await act(async () => {
      fireEvent.scroll(scrollableDiv)
    })

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalledTimes(2)
    })
  })

  it.each(['workflow', 'agent', 'prompt'])(
    'should open and close the selected %s log within the conversation',
    async (kind) => {
      mockChatConversationDetail = {
        id: 'conversation-1',
        model_config: { user_input_form: [] },
        message: { inputs: {} },
      }
      renderConversationList({
        appDetail: { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT },
        searchParams: '?conversation_id=conversation-1',
      })
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: `open-${kind}-log` }))
      const modalKind = kind === 'workflow' ? 'message' : kind
      expect(screen.getByTestId(`${modalKind}-log-modal`)).toBeInTheDocument()
      for (const other of ['message', 'agent', 'prompt'].filter((value) => value !== modalKind))
        expect(screen.queryByTestId(`${other}-log-modal`)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: `close-${modalKind}-log-modal` }))
      expect(screen.queryByTestId(`${modalKind}-log-modal`)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'open-no-log' }))
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
    },
  )

  it('should discard the selected log when the conversation drawer closes and reopens', async () => {
    mockChatConversationDetail = {
      id: 'conversation-1',
      model_config: { user_input_form: [] },
      message: { inputs: {} },
    }
    renderConversationList({
      appDetail: { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT },
      searchParams: '?conversation_id=conversation-1',
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'open-workflow-log' }))
    expect(screen.getByTestId('message-log-modal')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.close(?=$|:)/ }))
    await waitFor(() => expect(screen.queryByTestId('message-log-modal')).not.toBeInTheDocument())
    await user.click(screen.getByText('hello world'))
    await screen.findByTestId('chat-panel')
    expect(screen.queryByTestId('message-log-modal')).not.toBeInTheDocument()
  })
  it('should clear a selected log when URL navigation changes or closes the conversation', async () => {
    const user = userEvent.setup()
    const queryClient = createAccountProfileQueryClient({ timezone: 'Asia/Shanghai' })
    const appDetail = createAppDetailFixture({ mode: AppModeEnum.ADVANCED_CHAT })
    const view = (searchParams: string) => (
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <QueryClientTestProvider queryClient={queryClient}>
          <ConversationList
            appDetail={appDetail}
            logs={{ data: [], has_more: false, limit: 20, page: 1, total: 0 }}
            onRefresh={mockOnRefresh}
          />
        </QueryClientTestProvider>
      </NuqsTestingAdapter>
    )
    mockChatConversationDetail = {
      id: 'conversation-1',
      model_config: { user_input_form: [] },
      message: { inputs: {} },
    }
    const { rerender } = render(view('?conversation_id=conversation-1'))
    await user.click(await screen.findByRole('button', { name: 'open-workflow-log' }))
    expect(screen.getByTestId('message-log-modal')).toBeInTheDocument()
    mockChatConversationDetail = { ...mockChatConversationDetail, id: 'conversation-2' }
    rerender(view('?conversation_id=conversation-2'))
    await waitFor(() => expect(screen.queryByTestId('message-log-modal')).not.toBeInTheDocument())
    await user.click(await screen.findByRole('button', { name: 'open-agent-log' }))
    expect(screen.getByTestId('agent-log-modal')).toBeInTheDocument()
    rerender(view(''))
    await waitFor(() => expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument())
    rerender(view('?conversation_id=conversation-2'))
    await screen.findByTestId('chat-panel')
    expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
  })
})
