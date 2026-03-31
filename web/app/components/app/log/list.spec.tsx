import type { StatusCount } from './list-utils'
import type {
  Annotation,
  ChatConversationGeneralDetail,
  ChatConversationsResponse,
  CompletionConversationGeneralDetail,
  CompletionConversationsResponse,
} from '@/models/log'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import List from './list'
import {
  applyAddedAnnotation,
  applyEditedAnnotation,
  buildChatState,
  buildConversationUrl,
  buildDetailVarList,
  getAnnotationTooltipText,
  getConversationRowValues,
  getDetailMessageFiles,
  getFormattedChatList,
  getNextRetryCount,
  isReverseScrollNearTop,
  mergeUniqueChatItems,
  removeAnnotationFromChatItems,
  resolveConversationSelection,
  shouldThrottleLoad,

} from './list-utils'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockSetShowPromptLogModal = vi.fn()
const mockSetShowAgentLogModal = vi.fn()
const mockSetShowMessageLogModal = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => '/apps/test-app/logs',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  __esModule: true,
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: {
    setShowPromptLogModal: typeof mockSetShowPromptLogModal
    setShowAgentLogModal: typeof mockSetShowAgentLogModal
    setShowMessageLogModal: typeof mockSetShowMessageLogModal
  }) => unknown) => selector({
    setShowPromptLogModal: mockSetShowPromptLogModal,
    setShowAgentLogModal: mockSetShowAgentLogModal,
    setShowMessageLogModal: mockSetShowMessageLogModal,
  }),
}))

vi.mock('@/app/components/base/drawer', () => ({
  default: ({ children, isOpen }: { children: React.ReactNode, isOpen: boolean }) => (
    isOpen ? <div data-testid="drawer">{children}</div> : null
  ),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./list-detail-panel', () => ({
  ChatConversationDetailComp: ({ conversationId, onClose }: { conversationId?: string, onClose: () => void }) => (
    <div data-testid="chat-detail">
      <span>{conversationId}</span>
      <button type="button" onClick={onClose}>close-drawer</button>
    </div>
  ),
  CompletionConversationDetailComp: ({ conversationId, onClose }: { conversationId?: string, onClose: () => void }) => (
    <div data-testid="completion-detail">
      <span>{conversationId}</span>
      <button type="button" onClick={onClose}>close-drawer</button>
    </div>
  ),
}))

const createMockApp = (overrides: Partial<App> = {}) => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  author_name: 'Test Author',
  icon_type: 'emoji' as AppIconType,
  icon: '🚀',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: 'chat' as AppModeEnum,
  runtime_type: 'classic' as const,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: Date.now(),
  updated_at: Date.now(),
  site: {
    access_token: 'token',
    app_base_url: 'https://example.com',
  } as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
}) satisfies App

const createAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'annotation-1',
  authorName: 'Admin',
  logAnnotation: {
    id: 'log-annotation-1',
    content: 'Saved answer',
    account: {
      id: 'account-1',
      name: 'Admin',
      email: 'admin@example.com',
    },
    created_at: 123,
  },
  created_at: 123,
  ...overrides,
})

const createChatLog = (overrides: Partial<ChatConversationGeneralDetail> = {}): ChatConversationGeneralDetail => ({
  id: 'chat-conversation-1',
  status: 'normal',
  from_source: 'console',
  from_end_user_id: 'end-user-1',
  from_end_user_session_id: 'session-1',
  from_account_id: 'account-1',
  read_at: new Date(),
  created_at: 100,
  updated_at: 200,
  user_feedback_stats: { like: 1, dislike: 0 },
  admin_feedback_stats: { like: 0, dislike: 1 },
  model_config: {
    provider: 'openai',
    model_id: 'gpt-4',
    configs: {
      prompt_template: 'Prompt',
    },
  },
  summary: 'Chat summary',
  message_count: 2,
  annotated: false,
  ...overrides,
})

const createCompletionLog = (overrides: Partial<CompletionConversationGeneralDetail> = {}): CompletionConversationGeneralDetail => ({
  id: 'completion-conversation-1',
  status: 'finished',
  from_source: 'console',
  from_end_user_id: 'end-user-1',
  from_end_user_session_id: 'session-1',
  from_account_id: 'account-1',
  read_at: new Date(),
  created_at: 100,
  updated_at: 200,
  annotation: createAnnotation(),
  user_feedback_stats: { like: 0, dislike: 0 },
  admin_feedback_stats: { like: 1, dislike: 0 },
  model_config: {
    provider: 'openai',
    model_id: 'gpt-4',
    configs: {
      prompt_template: 'Prompt',
    },
  },
  message: {
    inputs: { query: 'completion input' },
    query: 'completion query',
    answer: 'completion answer',
    message: [],
  },
  ...overrides,
})

describe('list utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should merge only unique chat items', () => {
    const existingItems = [{ id: 'msg-1' }, { id: 'msg-2' }] as never[]
    const newItems = [{ id: 'msg-2' }, { id: 'msg-3' }] as never[]

    const result = mergeUniqueChatItems(existingItems, newItems)

    expect(result.uniqueNewItems).toHaveLength(1)
    expect(result.uniqueNewItems[0].id).toBe('msg-3')
    expect(result.mergedItems.map(item => item.id)).toEqual(['msg-3', 'msg-1', 'msg-2'])
  })

  it('should calculate retry counts for empty result pages', () => {
    expect(getNextRetryCount(0, 5, 0)).toBe(1)
    expect(getNextRetryCount(0, 5, 3)).toBe(0)
    expect(getNextRetryCount(2, 5, 2)).toBe(0)
  })

  it('should throttle scroll-triggered loads inside the debounce window', () => {
    expect(shouldThrottleLoad(1100, 1000)).toBe(true)
    expect(shouldThrottleLoad(1300, 1000)).toBe(false)
  })

  it('should detect reverse-scroll near-top state', () => {
    expect(isReverseScrollNearTop(-900, 1000, 100)).toBe(true)
    expect(isReverseScrollNearTop(-100, 1000, 100)).toBe(false)
  })

  it('should build and clear conversation urls', () => {
    const params = new URLSearchParams('page=2')

    expect(buildConversationUrl('/apps/test/logs', params, 'conversation-1')).toBe('/apps/test/logs?page=2&conversation_id=conversation-1')
    expect(buildConversationUrl('/apps/test/logs', new URLSearchParams('conversation_id=conversation-1'))).toBe('/apps/test/logs')
  })

  it('should resolve the active conversation from logs, cache, or placeholder', () => {
    const logs: ChatConversationsResponse = {
      data: [createChatLog()],
      has_more: false,
      limit: 20,
      total: 1,
      page: 1,
    }

    expect(resolveConversationSelection(logs, 'chat-conversation-1', undefined)).toMatchObject({ id: 'chat-conversation-1' })
    expect(resolveConversationSelection(undefined, 'cached-id', { id: 'cached-id', isPlaceholder: true })).toMatchObject({ id: 'cached-id' })
    expect(resolveConversationSelection(undefined, 'placeholder-id', undefined)).toMatchObject({ id: 'placeholder-id', isPlaceholder: true })
  })

  it('should format chat messages into question/answer items', () => {
    const formatted = getFormattedChatList([{
      id: 'message-1',
      conversation_id: 'conversation-1',
      query: 'What is Dify?',
      inputs: { query: 'What is Dify?' },
      message: [{ role: 'user', text: 'What is Dify?' }],
      message_tokens: 10,
      answer_tokens: 20,
      answer: 'An AI app platform',
      provider_response_latency: 1.2,
      created_at: 123,
      annotation: createAnnotation().logAnnotation!,
      annotation_hit_history: {
        annotation_id: 'history-1',
        annotation_create_account: {
          id: 'account-1',
          name: 'Admin',
          email: 'admin@example.com',
        },
        created_at: 120,
      },
      feedbacks: [{ rating: 'like', content: null, from_source: 'admin' }],
      message_files: [],
      metadata: {
        retriever_resources: [],
        annotation_reply: {
          id: 'annotation-reply-1',
          account: {
            id: 'account-1',
            name: 'Admin',
          },
        },
      },
      agent_thoughts: [],
      workflow_run_id: 'workflow-1',
      parent_message_id: null,
    }], 'conversation-1', 'UTC', 'YYYY-MM-DD')

    expect(formatted).toHaveLength(2)
    expect(formatted[0].id).toBe('question-message-1')
    expect(formatted[1].id).toBe('message-1')
    expect(formatted[1].annotation?.id).toBe('history-1')
  })

  it('should preserve assistant logs and fallback annotations when formatting chat messages', () => {
    const formatted = getFormattedChatList([{
      id: 'message-2',
      conversation_id: 'conversation-1',
      query: 'What is new?',
      inputs: { default_input: 'fallback input' },
      message: [{ role: 'assistant', text: 'Already normalized' }],
      message_tokens: 10,
      answer_tokens: 20,
      answer: 'Already normalized',
      provider_response_latency: 1.2,
      created_at: 123,
      annotation: createAnnotation().logAnnotation!,
      annotation_hit_history: undefined as never,
      feedbacks: [],
      message_files: [],
      metadata: {
        retriever_resources: [],
        annotation_reply: {
          id: 'annotation-reply-1',
          account: {
            id: 'account-1',
            name: 'Admin',
          },
        },
      },
      agent_thoughts: [],
      workflow_run_id: 'workflow-1',
      parent_message_id: null,
    }], 'conversation-1', 'UTC', 'YYYY-MM-DD')

    expect(formatted[0].content).toBe('fallback input')
    expect(formatted[1].log).toHaveLength(1)
    expect(formatted[1].annotation?.authorName).toBe('Admin')
  })

  it('should apply annotation add and edit updates to chat items', () => {
    const items = [
      { id: 'question-1', content: 'Old question' },
      { id: 'answer-1', content: 'Old answer' },
    ] as never[]

    const added = applyAddedAnnotation(items, 'annotation-1', 'Admin', 'New question', 'New answer', 1)
    const edited = applyEditedAnnotation(added, 'Edited question', 'Edited answer', 1)

    expect(added[0].content).toBe('New question')
    expect(added[1].annotation?.id).toBe('annotation-1')
    expect(edited[0].content).toBe('Edited question')
    expect(edited[1].annotation?.logAnnotation?.content).toBe('Edited answer')
  })

  it('should derive detail vars, files, row values, and tooltip text from typed data', () => {
    const completionDetail = {
      id: 'detail-1',
      status: 'finished',
      from_source: 'console',
      from_end_user_id: 'end-user-1',
      from_account_id: 'account-1',
      created_at: 100,
      model_config: {
        provider: 'openai',
        model_id: 'gpt-4',
        configs: {
          introduction: '',
          prompt_template: 'Prompt',
          prompt_variables: [],
          completion_params: {
            max_tokens: 10,
            temperature: 0.1,
            top_p: 0.9,
            stop: [],
            presence_penalty: 0,
            frequency_penalty: 0,
          },
        },
        user_input_form: [{ customer: { variable: 'customer' } }],
      },
      message: {
        id: 'message-1',
        conversation_id: 'detail-1',
        query: 'hello',
        inputs: { customer: 'Alice' },
        message: [],
        message_tokens: 0,
        answer_tokens: 0,
        answer: 'world',
        provider_response_latency: 0,
        created_at: 100,
        annotation: createAnnotation().logAnnotation!,
        annotation_hit_history: {
          annotation_id: 'annotation-hit',
          annotation_create_account: {
            id: 'account-1',
            name: 'Admin',
            email: 'admin@example.com',
          },
          created_at: 100,
        },
        feedbacks: [],
        message_files: [{
          id: 'file-1',
          type: 'image',
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/file.png',
          upload_file_id: 'upload-1',
          belongs_to: 'assistant',
        }],
        metadata: { retriever_resources: [] },
        agent_thoughts: [],
        workflow_run_id: 'workflow-1',
        parent_message_id: null,
      },
    } as never

    const vars = buildDetailVarList(completionDetail, {})
    const files = getDetailMessageFiles('completion' as AppModeEnum, completionDetail)
    const rowValues = getConversationRowValues(createCompletionLog({
      from_end_user_session_id: '',
      message: {
        ...createCompletionLog().message,
        inputs: { default_input: 'fallback query' },
        query: '',
        answer: 'completion answer',
      },
    }), false)
    const tooltipText = getAnnotationTooltipText(createAnnotation().logAnnotation, '03-30 05:00 PM', 'Saved by Admin')

    expect(vars).toEqual([{ label: 'customer', value: 'Alice' }])
    expect(files).toEqual(['https://example.com/file.png'])
    expect(getDetailMessageFiles('chat' as AppModeEnum, completionDetail)).toEqual([])
    expect(rowValues.endUser).toBe('account-1')
    expect(rowValues.leftValue).toBe('fallback query')
    expect(rowValues.rightValue).toBe('completion answer')
    expect(tooltipText).toBe('Saved by Admin 03-30 05:00 PM')
    expect(getAnnotationTooltipText(undefined, '03-30 05:00 PM', 'Saved')).toBe('')
  })

  it('should build chat state and remove annotations without mutating other items', () => {
    const items = [
      { id: 'question-1', content: 'Question', isAnswer: false },
      { id: 'answer-1', content: 'Answer', isAnswer: true, parentMessageId: 'question-1', annotation: createAnnotation() },
    ] as never[]

    expect(buildChatState([], false)).toEqual({
      chatItemTree: [],
      threadChatItems: [],
      oldestAnswerId: undefined,
    })

    const state = buildChatState(items, false, 'Opening statement')
    const removed = removeAnnotationFromChatItems(items, 1)

    expect(state.oldestAnswerId).toBe('answer-1')
    expect(state.threadChatItems[0].id).toBe('introduction')
    expect(removed[0].annotation).toBeUndefined()
    expect(removed[1].annotation).toBeUndefined()
  })
})

describe('List component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  it('should render a loading state when logs are undefined', () => {
    render(<List logs={undefined} appDetail={createMockApp()} onRefresh={vi.fn()} />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('should push conversation id and open the chat drawer when a row is clicked', async () => {
    const user = userEvent.setup()
    const logs: ChatConversationsResponse = {
      data: [Object.assign(createChatLog(), { name: 'Chat summary' })],
      has_more: false,
      limit: 20,
      total: 1,
      page: 1,
    }

    render(<List logs={logs} appDetail={createMockApp()} onRefresh={vi.fn()} />)

    await user.click(screen.getByText('Chat summary'))

    expect(mockPush).toHaveBeenCalledWith('/apps/test-app/logs?conversation_id=chat-conversation-1', { scroll: false })
  })

  it('should open from the url and clear the query param when the drawer closes', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams('conversation_id=chat-conversation-1')
    const logs: ChatConversationsResponse = {
      data: [createChatLog()],
      has_more: false,
      limit: 20,
      total: 1,
      page: 1,
    }
    const onRefresh = vi.fn()

    render(<List logs={logs} appDetail={createMockApp()} onRefresh={onRefresh} />)

    await waitFor(() => {
      expect(screen.getByTestId('drawer')).toBeInTheDocument()
    })

    await user.click(screen.getByText('close-drawer'))

    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(false)
    expect(mockSetShowAgentLogModal).toHaveBeenCalledWith(false)
    expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(false)
    expect(mockReplace).toHaveBeenCalledWith('/apps/test-app/logs', { scroll: false })
  })

  it('should render advanced chat status counts and completion annotations', () => {
    const advancedLogs: ChatConversationsResponse = {
      data: [
        Object.assign(createChatLog({
          id: 'advanced-conversation-1',
          summary: 'Advanced summary',
          annotated: true,
        }), {
          status_count: {
            paused: 0,
            success: 1,
            failed: 0,
            partial_success: 0,
          } satisfies StatusCount,
        }),
      ],
      has_more: false,
      limit: 20,
      total: 1,
      page: 1,
    }
    const completionLogs: CompletionConversationsResponse = {
      data: [createCompletionLog()],
      has_more: false,
      limit: 20,
      total: 1,
      page: 1,
    }

    const { rerender } = render(
      <List
        logs={advancedLogs}
        appDetail={createMockApp({ mode: 'advanced-chat' as AppModeEnum })}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText('Success')).toBeInTheDocument()

    rerender(
      <List
        logs={completionLogs}
        appDetail={createMockApp({ mode: 'completion' as AppModeEnum })}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText(/appLog.detail.annotationTip/)).toBeInTheDocument()
  })

  it('should render pending, partial-success, and failure statuses for advanced chat rows', () => {
    const advancedLogs: ChatConversationsResponse = {
      data: [
        Object.assign(createChatLog({ id: 'pending-log', summary: 'Pending summary' }), {
          status_count: {
            paused: 1,
            success: 0,
            failed: 0,
            partial_success: 0,
          } satisfies StatusCount,
        }),
        Object.assign(createChatLog({ id: 'partial-log', summary: 'Partial summary' }), {
          status_count: {
            paused: 0,
            success: 0,
            failed: 0,
            partial_success: 2,
          } satisfies StatusCount,
        }),
        Object.assign(createChatLog({ id: 'failure-log', summary: 'Failure summary' }), {
          status_count: {
            paused: 0,
            success: 0,
            failed: 2,
            partial_success: 0,
          } satisfies StatusCount,
        }),
      ],
      has_more: false,
      limit: 20,
      total: 3,
      page: 1,
    }

    render(
      <List
        logs={advancedLogs}
        appDetail={createMockApp({ mode: 'advanced-chat' as AppModeEnum })}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Partial Success')).toBeInTheDocument()
    expect(screen.getByText('2 Failures')).toBeInTheDocument()
  })
})
