/* eslint-disable ts/no-explicit-any */
import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppModeEnum } from '@/types/app'
import ConversationList from '../list'

const mockFetchChatMessages = vi.fn()
const mockUpdateLogMessageFeedbacks = vi.fn()
const mockUpdateLogMessageAnnotations = vi.fn()
const mockOnRefresh = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowPromptLogModal = vi.fn()
const mockSetShowAgentLogModal = vi.fn()
const mockSetShowMessageLogModal = vi.fn()
const mockCompletionRefetch = vi.fn()
const mockDelAnnotation = vi.fn()

let mockChatConversationDetail: Record<string, unknown> | undefined
let mockCompletionConversationDetail: Record<string, unknown> | undefined
let mockShowMessageLogModal = false
let mockShowPromptLogModal = false
let mockCurrentLogItem: Record<string, unknown> | undefined
let mockCurrentLogModalActiveTab = 'messages'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      timezone: 'Asia/Shanghai',
    },
  }),
}))

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

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentLogItem: mockCurrentLogItem,
    setCurrentLogItem: mockSetCurrentLogItem,
    showMessageLogModal: mockShowMessageLogModal,
    setShowPromptLogModal: mockSetShowPromptLogModal,
    setShowAgentLogModal: mockSetShowAgentLogModal,
    setShowMessageLogModal: mockSetShowMessageLogModal,
    showPromptLogModal: mockShowPromptLogModal,
    currentLogModalActiveTab: mockCurrentLogModalActiveTab,
  }),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/app/log/model-info', () => ({
  default: ({ model }: { model: string }) => <div data-testid="model-info">{model}</div>,
}))

vi.mock('@/app/components/app/log/var-panel', () => ({
  default: ({ varList }: { varList: Array<{ label: string, value: string }> }) => (
    <div data-testid="var-panel">{varList.map(item => `${item.label}:${item.value}`).join(',')}</div>
  ),
}))

vi.mock('@/app/components/base/copy-icon', () => ({
  default: ({ content }: { content: string }) => <div data-testid="copy-icon">{content}</div>,
}))

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: ({
    content,
    onFeedback,
  }: {
    content: string
    onFeedback: (value: { rating: string, content?: string }) => Promise<boolean>
  }) => (
    <div data-testid="text-generation">
      <div>{content}</div>
      <button onClick={() => void onFeedback({ rating: 'like', content: 'great' })}>completion-feedback</button>
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
  }: {
    chatList: Array<{ id: string }>
    onFeedback: (mid: string, value: { rating: string, content?: string }) => Promise<boolean>
    onAnnotationAdded: (annotationId: string, authorName: string, query: string, answer: string, index: number) => void
    onAnnotationEdited: (query: string, answer: string, index: number) => void
    onAnnotationRemoved: (index: number) => Promise<boolean>
    switchSibling: (siblingMessageId: string) => void
  }) => (
    <div data-testid="chat-panel">
      <div>{chatList.length}</div>
      <button onClick={() => void onFeedback('message-1', { rating: 'like', content: 'nice' })}>chat-feedback</button>
      <button onClick={() => onAnnotationAdded('annotation-2', 'Admin', 'Edited question', 'Edited answer', 1)}>chat-add-annotation</button>
      <button onClick={() => onAnnotationEdited('Updated question', 'Updated answer', 1)}>chat-edit-annotation</button>
      <button onClick={() => void onAnnotationRemoved(1)}>chat-remove-annotation</button>
      <button onClick={() => switchSibling('message-2')}>chat-switch-sibling</button>
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
  return renderWithNuqs(
    <ConversationList
      appDetail={appDetail}
      logs={logs}
      onRefresh={mockOnRefresh}
    />,
    { searchParams },
  )
}

describe('ConversationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatConversationDetail = undefined
    mockCompletionConversationDetail = undefined
    mockShowMessageLogModal = false
    mockShowPromptLogModal = false
    mockCurrentLogItem = undefined
    mockCurrentLogModalActiveTab = 'messages'
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
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(update.searchParams.get('page')).toBe('2')
    expect(update.searchParams.get('conversation_id')).toBe('conversation-1')
    expect(update.options.history).toBe('push')
  })

  it('should close the drawer, refresh, and clear modal flags', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: 'operation.close' }))

    expect(mockOnRefresh).toHaveBeenCalledTimes(1)
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(false)
    expect(mockSetShowAgentLogModal).toHaveBeenCalledWith(false)
    expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(false)

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
    mockShowMessageLogModal = true
    mockCurrentLogItem = { id: 'log-1' }

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
    expect(screen.getByTestId('message-log-modal')).toBeInTheDocument()

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
    mockShowPromptLogModal = true
    mockCurrentLogItem = { id: 'log-2' }

    renderConversationList({
      appDetail: { id: 'app-1', mode: AppModeEnum.COMPLETION } as any,
      logs: createCompletionLogs() as any,
      searchParams: '?page=2&conversation_id=conversation-1',
    })

    await waitFor(() => {
      expect(screen.getByTestId('text-generation')).toBeInTheDocument()
    })

    expect(screen.getByTestId('var-panel')).toHaveTextContent('query:Question')
    expect(screen.getByTestId('prompt-log-modal')).toBeInTheDocument()

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

  it('should support annotation changes, modal closing, and paginated scroll loading in the detail drawer', async () => {
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
    mockShowMessageLogModal = true
    mockCurrentLogItem = { id: 'log-1' }
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
      expect(screen.getByText('detail.loading...')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('chat-add-annotation'))
    fireEvent.click(screen.getByText('chat-edit-annotation'))
    fireEvent.click(screen.getByText('chat-remove-annotation'))

    await waitFor(() => {
      expect(mockDelAnnotation).toHaveBeenCalledWith('app-1', 'annotation-2')
    })

    fireEvent.click(screen.getByText('close-message-log-modal'))
    expect(mockSetCurrentLogItem).toHaveBeenCalled()
    expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(false)

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

  it('should close the prompt log modal from completion detail drawers', async () => {
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
    mockShowPromptLogModal = true
    mockCurrentLogItem = { id: 'log-2' }

    renderConversationList({
      appDetail: { id: 'app-1', mode: AppModeEnum.COMPLETION } as any,
      logs: createCompletionLogs() as any,
      searchParams: '?page=2&conversation_id=conversation-1',
    })

    expect(await screen.findByTestId('prompt-log-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('close-prompt-log-modal'))

    expect(mockSetCurrentLogItem).toHaveBeenCalled()
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(false)
  })
})
