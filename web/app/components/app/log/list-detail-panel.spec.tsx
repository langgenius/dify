import type {
  ChatConversationFullDetailResponse,
  ChatMessagesResponse,
  CompletionConversationFullDetailResponse,
  MessageContent,
} from '@/models/log'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { ChatConversationDetailComp, CompletionConversationDetailComp } from './list-detail-panel'

const mockFetchChatMessages = vi.fn()
const mockUpdateLogMessageFeedbacks = vi.fn()
const mockRefetchCompletionDetail = vi.fn()
const mockDelAnnotation = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowMessageLogModal = vi.fn()
const mockSetShowPromptLogModal = vi.fn()

let mockChatDetail: ChatConversationFullDetailResponse | undefined
let mockCompletionDetail: CompletionConversationFullDetailResponse | undefined
let mockStoreState: {
  currentLogItem?: Record<string, unknown>
  currentLogModalActiveTab?: string
  setCurrentLogItem: typeof mockSetCurrentLogItem
  setShowMessageLogModal: typeof mockSetShowMessageLogModal
  setShowPromptLogModal: typeof mockSetShowPromptLogModal
  showMessageLogModal: boolean
  showPromptLogModal: boolean
}

vi.mock('@/service/log', () => ({
  fetchChatMessages: (...args: unknown[]) => mockFetchChatMessages(...args),
  updateLogMessageFeedbacks: (...args: unknown[]) => mockUpdateLogMessageFeedbacks(...args),
}))

vi.mock('@/service/use-log', () => ({
  useChatConversationDetail: () => ({ data: mockChatDetail }),
  useCompletionConversationDetail: () => ({ data: mockCompletionDetail, refetch: mockRefetchCompletionDetail }),
}))

vi.mock('@/service/annotation', () => ({
  delAnnotation: (...args: unknown[]) => mockDelAnnotation(...args),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      timezone: 'UTC',
    },
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  __esModule: true,
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/app/log/model-info', () => ({
  default: () => <div data-testid="model-info">model-info</div>,
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/copy-icon', () => ({
  default: () => <div data-testid="copy-icon">copy-icon</div>,
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/base/message-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="message-log-modal">
      <button type="button" onClick={onCancel}>close-message-log</button>
    </div>
  ),
}))

vi.mock('../../base/prompt-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="prompt-log-modal">
      <button type="button" onClick={onCancel}>close-prompt-log</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./var-panel', () => ({
  default: ({ message_files, varList }: { message_files: string[], varList: Array<{ label: string, value: string }> }) => (
    <div data-testid="var-panel">{`${varList.length}-${message_files.length}`}</div>
  ),
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: ({
    chatList,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    onFeedback,
    switchSibling,
  }: {
    chatList: Array<{ id: string }>
    onAnnotationAdded: (annotationId: string, authorName: string, query: string, answer: string, index: number) => void
    onAnnotationEdited: (query: string, answer: string, index: number) => void
    onAnnotationRemoved: (index: number) => Promise<boolean>
    onFeedback: (messageId: string, payload: { rating: 'like' | 'dislike', content?: string }) => Promise<boolean>
    switchSibling: (messageId: string) => void
  }) => (
    <div data-testid="chat-component">
      <span data-testid="chat-count">{chatList.length}</span>
      <button type="button" onClick={() => onFeedback('message-1', { rating: 'like', content: 'great' })}>chat-feedback</button>
      <button type="button" onClick={() => onAnnotationAdded('annotation-2', 'Reviewer', 'updated question', 'updated answer', 1)}>add-annotation</button>
      <button type="button" onClick={() => onAnnotationEdited('edited question', 'edited answer', 1)}>edit-annotation</button>
      <button type="button" onClick={() => void onAnnotationRemoved(1)}>remove-annotation</button>
      <button type="button" onClick={() => switchSibling('message-1')}>switch-sibling</button>
    </div>
  ),
}))

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: ({ content, onFeedback }: { content: string, onFeedback: (payload: { rating: 'like' | 'dislike', content?: string }) => Promise<boolean> }) => (
    <div data-testid="text-generation">
      <span>{content}</span>
      <button type="button" onClick={() => onFeedback({ rating: 'like', content: 'great' })}>completion-feedback</button>
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

const createMessage = (): MessageContent => ({
  id: 'message-1',
  conversation_id: 'conversation-1',
  query: 'hello',
  inputs: { customer: 'Alice' },
  message: [{ role: 'user', text: 'hello' }],
  message_tokens: 10,
  answer_tokens: 12,
  answer: 'world',
  provider_response_latency: 1.23,
  created_at: 100,
  annotation: {
    id: 'annotation-1',
    content: 'annotated answer',
    account: {
      id: 'account-1',
      name: 'Admin',
      email: 'admin@example.com',
    },
    created_at: 123,
  },
  annotation_hit_history: {
    annotation_id: 'annotation-hit-1',
    annotation_create_account: {
      id: 'account-1',
      name: 'Admin',
      email: 'admin@example.com',
    },
    created_at: 123,
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
})

describe('list detail panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockChatDetail = {
      id: 'chat-conversation-1',
      status: 'normal',
      from_source: 'console',
      from_end_user_id: 'end-user-1',
      from_end_user_session_id: 'session-1',
      from_account_id: 'account-1',
      read_at: new Date(),
      created_at: 100,
      updated_at: 200,
      annotation: {
        id: 'annotation-1',
        authorName: 'Admin',
        created_at: 123,
      },
      user_feedback_stats: { like: 1, dislike: 0 },
      admin_feedback_stats: { like: 0, dislike: 1 },
      message_count: 2,
      model_config: {
        provider: 'openai',
        model_id: 'gpt-4',
        configs: {
          introduction: 'hello',
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
        model: {
          name: 'gpt-4',
          provider: 'openai',
          completion_params: {
            max_tokens: 10,
            temperature: 0.1,
            top_p: 0.9,
            stop: [],
            presence_penalty: 0,
            frequency_penalty: 0,
          },
        },
      },
    }

    mockCompletionDetail = {
      id: 'completion-conversation-1',
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
      },
      message: {
        ...createMessage(),
        message_files: [{
          id: 'file-1',
          type: 'image',
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/file.png',
          upload_file_id: 'upload-1',
          belongs_to: 'assistant',
        }],
      },
    }

    mockStoreState = {
      currentLogItem: { id: 'log-item-1' },
      currentLogModalActiveTab: 'trace',
      setCurrentLogItem: mockSetCurrentLogItem,
      setShowMessageLogModal: mockSetShowMessageLogModal,
      setShowPromptLogModal: mockSetShowPromptLogModal,
      showMessageLogModal: false,
      showPromptLogModal: false,
    }

    mockFetchChatMessages.mockResolvedValue({
      data: [createMessage()],
      has_more: false,
      limit: 10,
    } satisfies ChatMessagesResponse)
    mockUpdateLogMessageFeedbacks.mockResolvedValue({ result: 'success' })
    mockDelAnnotation.mockResolvedValue(undefined)
  })

  it('should fetch chat messages and handle feedback and annotation removal', async () => {
    const user = userEvent.setup()

    render(
      <ChatConversationDetailComp
        appDetail={createMockApp({ mode: 'chat' as AppModeEnum })}
        conversationId="chat-conversation-1"
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalledWith({
        url: '/apps/test-app-id/chat-messages',
        params: {
          conversation_id: 'chat-conversation-1',
          limit: 10,
        },
      })
    })

    expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('chat-count')).toHaveTextContent('3')
    })

    await user.click(screen.getByText('chat-feedback'))
    await user.click(screen.getByText('remove-annotation'))
    await user.click(screen.getByText('switch-sibling'))

    await waitFor(() => {
      expect(mockUpdateLogMessageFeedbacks).toHaveBeenCalledWith({
        url: '/apps/test-app-id/feedbacks',
        body: { message_id: 'message-1', rating: 'like', content: 'great' },
      })
      expect(mockDelAnnotation).toHaveBeenCalledWith('test-app-id', 'annotation-hit-1')
    })

    expect(mockToastSuccess).toHaveBeenCalled()
  })

  it('should render completion output, refetch on feedback, and close prompt/message modals', async () => {
    const user = userEvent.setup()
    mockStoreState = {
      ...mockStoreState,
      showMessageLogModal: true,
      showPromptLogModal: true,
    }

    render(
      <CompletionConversationDetailComp
        appDetail={createMockApp({ mode: 'completion' as AppModeEnum })}
        conversationId="completion-conversation-1"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('text-generation')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
    expect(screen.getByTestId('var-panel')).toHaveTextContent('0-1')
    expect(screen.getByTestId('message-log-modal')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-log-modal')).toBeInTheDocument()

    await user.click(screen.getByText('completion-feedback'))

    await waitFor(() => {
      expect(mockUpdateLogMessageFeedbacks).toHaveBeenCalledWith({
        url: '/apps/test-app-id/feedbacks',
        body: { message_id: 'message-1', rating: 'like', content: 'great' },
      })
      expect(mockRefetchCompletionDetail).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByText('close-message-log'))
    await user.click(screen.getByText('close-prompt-log'))

    expect(mockSetCurrentLogItem).toHaveBeenCalled()
    expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(false)
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(false)
  })

  it('should show an error toast when feedback updates fail', async () => {
    const user = userEvent.setup()
    mockUpdateLogMessageFeedbacks.mockRejectedValueOnce(new Error('update failed'))

    render(
      <CompletionConversationDetailComp
        appDetail={createMockApp({ mode: 'completion' as AppModeEnum })}
        conversationId="completion-conversation-1"
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByText('completion-feedback'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  it('should render nothing when conversation detail is unavailable', () => {
    mockChatDetail = undefined
    mockCompletionDetail = undefined

    const { container, rerender } = render(
      <ChatConversationDetailComp
        appDetail={createMockApp({ mode: 'chat' as AppModeEnum })}
        conversationId="chat-conversation-1"
        onClose={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <CompletionConversationDetailComp
        appDetail={createMockApp({ mode: 'completion' as AppModeEnum })}
        conversationId="completion-conversation-1"
        onClose={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
