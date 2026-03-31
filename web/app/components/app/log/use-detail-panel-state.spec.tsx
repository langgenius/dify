import type { ChatConversationFullDetailResponse, ChatMessagesResponse, CompletionConversationFullDetailResponse, MessageContent } from '@/models/log'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { useDetailPanelState } from './use-detail-panel-state'

const mockFetchChatMessages = vi.fn()
const mockDelAnnotation = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowMessageLogModal = vi.fn()
const mockSetShowPromptLogModal = vi.fn()

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

const createMessage = (overrides: Partial<MessageContent> = {}): MessageContent => ({
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
  ...overrides,
})

const createChatDetail = (): ChatConversationFullDetailResponse => ({
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
})

const createCompletionDetail = (): CompletionConversationFullDetailResponse => ({
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
})

describe('useDetailPanelState', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()

    mockStoreState = {
      currentLogItem: { id: 'log-item-1' },
      currentLogModalActiveTab: 'trace',
      setCurrentLogItem: mockSetCurrentLogItem,
      setShowMessageLogModal: mockSetShowMessageLogModal,
      setShowPromptLogModal: mockSetShowPromptLogModal,
      showMessageLogModal: false,
      showPromptLogModal: false,
    }
  })

  it('should fetch initial chat data and derive thread state', async () => {
    mockFetchChatMessages.mockResolvedValue({
      data: [createMessage()],
      has_more: false,
      limit: 10,
    } satisfies ChatMessagesResponse)

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalled()
      expect(result.current.threadChatItems).toHaveLength(3)
    })

    expect(result.current.isChatMode).toBe(true)
    expect(result.current.isAdvanced).toBe(false)
    expect(result.current.messageFiles).toEqual([])
  })

  it('should update annotations in memory and remove them successfully', async () => {
    mockFetchChatMessages.mockResolvedValue({
      data: [createMessage()],
      has_more: false,
      limit: 10,
    } satisfies ChatMessagesResponse)
    mockDelAnnotation.mockResolvedValue(undefined)

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    await waitFor(() => {
      expect(result.current.threadChatItems).toHaveLength(3)
    })

    act(() => {
      result.current.handleAnnotationAdded('annotation-2', 'Reviewer', 'updated question', 'updated answer', 1)
      result.current.handleAnnotationEdited('edited question', 'edited answer', 1)
    })

    await act(async () => {
      await result.current.handleAnnotationRemoved(1)
    })

    expect(mockDelAnnotation).toHaveBeenCalledWith('test-app-id', 'annotation-2')
    expect(mockToastSuccess).toHaveBeenCalled()
  })

  it('should report annotation removal failures', async () => {
    mockFetchChatMessages.mockResolvedValue({
      data: [createMessage()],
      has_more: false,
      limit: 10,
    } satisfies ChatMessagesResponse)
    mockDelAnnotation.mockRejectedValue(new Error('delete failed'))

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    await waitFor(() => {
      expect(result.current.threadChatItems).toHaveLength(3)
    })

    await act(async () => {
      await result.current.handleAnnotationRemoved(1)
    })

    expect(mockToastError).toHaveBeenCalled()
  })

  it('should stop loading more when scroll container is missing', () => {
    mockFetchChatMessages.mockResolvedValue({
      data: [createMessage()],
      has_more: false,
      limit: 10,
    } satisfies ChatMessagesResponse)
    const getElementByIdSpy = vi.spyOn(document, 'getElementById').mockReturnValue(null)

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    return waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalled()
    }).then(() => {
      act(() => {
        result.current.handleScroll()
      })

      expect(getElementByIdSpy).toHaveBeenCalledWith('scrollableDiv')
    })
  })

  it('should load more messages on near-top scroll and stop when the next page is empty', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)
    mockFetchChatMessages
      .mockResolvedValueOnce({
        data: [createMessage()],
        has_more: true,
        limit: 10,
      } satisfies ChatMessagesResponse)
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
        limit: 10,
      } satisfies ChatMessagesResponse)

    const fakeScrollableDiv = {
      scrollTop: -900,
      scrollHeight: 1000,
      clientHeight: 100,
    } as HTMLElement
    vi.spyOn(document, 'getElementById').mockReturnValue(fakeScrollableDiv)

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    await waitFor(() => {
      expect(result.current.threadChatItems).toHaveLength(2)
    })

    act(() => {
      result.current.handleScroll()
    })

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalledTimes(2)
    })
  })

  it('should keep width in sync and ignore duplicate load-more pages', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
    const rafCallbacks: FrameRequestCallback[] = []
    requestAnimationFrameSpy.mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    Object.defineProperty(document.body, 'clientWidth', {
      configurable: true,
      value: 1024,
    })

    mockFetchChatMessages
      .mockResolvedValueOnce({
        data: [createMessage()],
        has_more: true,
        limit: 10,
      } satisfies ChatMessagesResponse)
      .mockResolvedValueOnce({
        data: [createMessage()],
        has_more: true,
        limit: 10,
      } satisfies ChatMessagesResponse)

    const fakeScrollableDiv = {
      scrollTop: -900,
      scrollHeight: 1000,
      clientHeight: 100,
    } as HTMLElement
    vi.spyOn(document, 'getElementById').mockReturnValue(fakeScrollableDiv)

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    await waitFor(() => {
      expect(result.current.threadChatItems).toHaveLength(2)
    })

    act(() => {
      Object.defineProperty(result.current.containerRef, 'current', {
        configurable: true,
        value: { clientWidth: 200 },
      })
      rafCallbacks[0]?.(0)
    })

    expect(result.current.width).toBe(800)

    act(() => {
      result.current.handleScroll()
    })

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalledTimes(2)
    })

    expect(mockFetchChatMessages).toHaveBeenLastCalledWith({
      url: '/apps/test-app-id/chat-messages',
      params: {
        conversation_id: 'chat-conversation-1',
        limit: 10,
        first_id: 'message-1',
      },
    })
    expect(result.current.threadChatItems).toHaveLength(2)
    nowSpy.mockRestore()
  })

  it('should stop future loads after a load-more error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)

    mockFetchChatMessages
      .mockResolvedValueOnce({
        data: [createMessage()],
        has_more: true,
        limit: 10,
      } satisfies ChatMessagesResponse)
      .mockRejectedValueOnce(new Error('load-more failed'))

    const fakeScrollableDiv = {
      scrollTop: -900,
      scrollHeight: 1000,
      clientHeight: 100,
    } as HTMLElement
    vi.spyOn(document, 'getElementById').mockReturnValue(fakeScrollableDiv)

    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'chat' as AppModeEnum }),
      detail: createChatDetail(),
    }))

    await waitFor(() => {
      expect(result.current.threadChatItems).toHaveLength(2)
    })

    act(() => {
      result.current.handleScroll()
    })

    await waitFor(() => {
      expect(mockFetchChatMessages).toHaveBeenCalledTimes(2)
    })

    nowSpy.mockReturnValue(1300)
    act(() => {
      result.current.handleScroll()
    })

    expect(mockFetchChatMessages).toHaveBeenCalledTimes(2)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('should skip the initial chat fetch for completion mode', async () => {
    const { result } = renderHook(() => useDetailPanelState({
      appDetail: createMockApp({ mode: 'completion' as AppModeEnum }),
      detail: createCompletionDetail(),
    }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockFetchChatMessages).not.toHaveBeenCalled()
    expect(result.current.isChatMode).toBe(false)
    expect(result.current.messageFiles).toEqual(['https://example.com/file.png'])
  })
})
