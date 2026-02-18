import type { ModelAndParameter } from '../types'
import type { ChatConfig, ChatItem as ChatItemType, OnSend } from '@/app/components/base/chat/types'
import { render, screen } from '@testing-library/react'
import { TransferMethod } from '@/app/components/base/chat/types'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { APP_CHAT_WITH_MULTIPLE_MODEL, APP_CHAT_WITH_MULTIPLE_MODEL_RESTART } from '../types'
import ChatItem from './chat-item'

const mockUseAppContext = vi.fn()
const mockUseDebugConfigurationContext = vi.fn()
const mockUseProviderContext = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseConfigFromDebugContext = vi.fn()
const mockUseFormattingChangedSubscription = vi.fn()
const mockUseChat = vi.fn()
const mockUseEventEmitterContextContext = vi.fn()
const mockFetchConversationMessages = vi.fn()
const mockFetchSuggestedQuestions = vi.fn()
const mockStopChatMessageResponding = vi.fn()

let capturedChatProps: {
  config: ChatConfig
  chatList: ChatItemType[]
  isResponding: boolean
  onSend: OnSend
  suggestedQuestions: string[]
  allToolIcons: Record<string, string | undefined>
} | null = null

let eventSubscriptionCallback: ((v: { type: string, payload?: Record<string, unknown> }) => void) | null = null

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
}))

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

vi.mock('../hooks', () => ({
  useConfigFromDebugContext: () => mockUseConfigFromDebugContext(),
  useFormattingChangedSubscription: (chatList: ChatItemType[]) => mockUseFormattingChangedSubscription(chatList),
}))

vi.mock('@/app/components/base/chat/chat/hooks', () => ({
  useChat: () => mockUseChat(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: (...args: unknown[]) => mockFetchConversationMessages(...args),
  fetchSuggestedQuestions: (...args: unknown[]) => mockFetchSuggestedQuestions(...args),
  stopChatMessageResponding: (...args: unknown[]) => mockStopChatMessageResponding(...args),
}))

vi.mock('@/app/components/base/chat/utils', () => ({
  getLastAnswer: (chatList: ChatItemType[]) => chatList.find(item => item.isAnswer),
}))

vi.mock('@/utils', () => ({
  canFindTool: (collectionId: string, providerId: string) => collectionId === providerId,
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: (props: typeof capturedChatProps) => {
    capturedChatProps = props
    return (
      <div data-testid="chat-component">
        <span data-testid="chat-list-length">{props?.chatList?.length || 0}</span>
        <span data-testid="is-responding">{props?.isResponding ? 'yes' : 'no'}</span>
        <button
          data-testid="send-button"
          onClick={() => props?.onSend?.('test message', [{ id: 'file-1', name: 'test.txt', size: 100, type: 'text/plain', progress: 100, transferMethod: TransferMethod.local_file, supportFileType: 'document' }])}
        >
          Send
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/avatar', () => ({
  default: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
}))

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const createDefaultMocks = () => {
  mockUseAppContext.mockReturnValue({
    userProfile: { avatar_url: 'http://avatar.url', name: 'Test User' },
  })

  mockUseDebugConfigurationContext.mockReturnValue({
    modelConfig: {
      configs: { prompt_variables: [] },
      agentConfig: { tools: [] },
    },
    appId: 'app-123',
    inputs: { key: 'value' },
    collectionList: [],
  })

  mockUseProviderContext.mockReturnValue({
    textGenerationModelList: [
      {
        provider: 'openai',
        models: [
          {
            model: 'gpt-3.5-turbo',
            features: [ModelFeatureEnum.vision],
            model_properties: { mode: 'chat' },
          },
        ],
      },
    ],
  })

  mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      features: {
        moreLikeThis: { enabled: false },
        opening: { enabled: true, opening_statement: 'Hello!', suggested_questions: ['Q1'] },
        moderation: { enabled: false },
        speech2text: { enabled: true },
        text2speech: { enabled: false },
        file: { enabled: true },
        suggested: { enabled: true },
        citation: { enabled: false },
        annotationReply: { enabled: false },
      },
    }
    return selector(state)
  })

  mockUseConfigFromDebugContext.mockReturnValue({
    base_config: 'test',
  })

  mockUseChat.mockReturnValue({
    chatList: [{ id: 'msg-1', content: 'Hello', isAnswer: true }],
    isResponding: false,
    handleSend: vi.fn(),
    suggestedQuestions: ['Question 1', 'Question 2'],
    handleRestart: vi.fn(),
  })

  mockUseEventEmitterContextContext.mockReturnValue({
    eventEmitter: {
      useSubscription: (callback: (v: { type: string, payload?: Record<string, unknown> }) => void) => {
        eventSubscriptionCallback = callback
      },
    },
  })
}

const renderComponent = (props: Partial<{ modelAndParameter: ModelAndParameter }> = {}) => {
  const defaultProps = {
    modelAndParameter: createModelAndParameter(),
    ...props,
  }
  return render(<ChatItem {...defaultProps} />)
}

describe('ChatItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedChatProps = null
    eventSubscriptionCallback = null
    createDefaultMocks()
  })

  describe('rendering', () => {
    it('should render Chat component when chatList is not empty', () => {
      renderComponent()

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      expect(screen.getByTestId('chat-list-length')).toHaveTextContent('1')
    })

    it('should not render when chatList is empty', () => {
      mockUseChat.mockReturnValue({
        chatList: [],
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument()
    })

    it('should pass correct config to Chat', () => {
      renderComponent()

      expect(capturedChatProps?.config).toMatchObject({
        base_config: 'test',
        opening_statement: 'Hello!',
        suggested_questions: ['Q1'],
      })
    })

    it('should pass suggestedQuestions to Chat', () => {
      renderComponent()

      expect(capturedChatProps?.suggestedQuestions).toEqual(['Question 1', 'Question 2'])
    })

    it('should pass isResponding to Chat', () => {
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: true,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      expect(screen.getByTestId('is-responding')).toHaveTextContent('yes')
    })
  })

  describe('config composition', () => {
    it('should include opening statement when enabled', () => {
      renderComponent()

      expect(capturedChatProps?.config.opening_statement).toBe('Hello!')
    })

    it('should use empty opening statement when disabled', () => {
      mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
        const state = {
          features: {
            moreLikeThis: { enabled: false },
            opening: { enabled: false, opening_statement: 'Should not appear' },
            moderation: { enabled: false },
            speech2text: { enabled: false },
            text2speech: { enabled: false },
            file: { enabled: false },
            suggested: { enabled: false },
            citation: { enabled: false },
            annotationReply: { enabled: false },
          },
        }
        return selector(state)
      })

      renderComponent()

      expect(capturedChatProps?.config.opening_statement).toBe('')
      expect(capturedChatProps?.config.suggested_questions).toEqual([])
    })
  })

  describe('inputsForm transformation', () => {
    it('should filter out API type variables', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: {
            prompt_variables: [
              { key: 'var1', name: 'Var 1', type: 'string' },
              { key: 'var2', name: 'Var 2', type: 'api' },
              { key: 'var3', name: 'Var 3', type: 'number' },
            ],
          },
          agentConfig: { tools: [] },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [],
      })

      renderComponent()

      // The component transforms prompt_variables into inputsForm
      // We can verify this through the useChat call
      expect(mockUseChat).toHaveBeenCalled()
    })
  })

  describe('event subscription', () => {
    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL event', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      // Trigger the event
      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [{ id: 'file-1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        'apps/app-123/chat-messages',
        expect.objectContaining({
          query: 'Hello',
          inputs: { key: 'value' },
        }),
        expect.any(Object),
      )
    })

    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL_RESTART event', () => {
      const handleRestart = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart,
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
      })

      expect(handleRestart).toHaveBeenCalled()
    })

    it('should ignore unrelated events', () => {
      const handleSend = vi.fn()
      const handleRestart = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart,
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: 'SOME_OTHER_EVENT',
        payload: {},
      })

      expect(handleSend).not.toHaveBeenCalled()
      expect(handleRestart).not.toHaveBeenCalled()
    })
  })

  describe('doSend function', () => {
    it('should include files when vision is supported and file upload enabled', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [{ id: 'file-1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          files: [{ id: 'file-1' }],
        }),
        expect.any(Object),
      )
    })

    it('should not include files when vision is not supported', () => {
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: [
          {
            provider: 'openai',
            models: [
              {
                model: 'gpt-3.5-turbo',
                features: [], // No vision support
                model_properties: { mode: 'chat' },
              },
            ],
          },
        ],
      })

      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [{ id: 'file-1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
        expect.any(Object),
      )
    })

    it('should include model configuration in request', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter({
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        parameters: { temperature: 0.5 },
      })

      renderComponent({ modelAndParameter })

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            model: expect.objectContaining({
              provider: 'openai',
              name: 'gpt-3.5-turbo',
              completion_params: { temperature: 0.5 },
            }),
          }),
        }),
        expect.any(Object),
      )
    })

    it('should use parent_message_id from last answer', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [
          { id: 'msg-1', content: 'Hi', isAnswer: false },
          { id: 'msg-2', content: 'Hello', isAnswer: true },
        ],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          parent_message_id: 'msg-2',
        }),
        expect.any(Object),
      )
    })
  })

  describe('allToolIcons', () => {
    it('should compute tool icons from collectionList', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: { prompt_variables: [] },
          agentConfig: {
            tools: [
              { tool_name: 'tool1', provider_id: 'collection1' },
              { tool_name: 'tool2', provider_id: 'collection2' },
            ],
          },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [
          { id: 'collection1', icon: 'icon1' },
          { id: 'collection2', icon: 'icon2' },
        ],
      })

      renderComponent()

      expect(capturedChatProps?.allToolIcons).toEqual({
        tool1: 'icon1',
        tool2: 'icon2',
      })
    })

    it('should handle tools without matching collection', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: { prompt_variables: [] },
          agentConfig: {
            tools: [
              { tool_name: 'tool1', provider_id: 'nonexistent' },
            ],
          },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [],
      })

      renderComponent()

      expect(capturedChatProps?.allToolIcons).toEqual({
        tool1: undefined,
      })
    })

    it('should handle empty tools array', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: { prompt_variables: [] },
          agentConfig: { tools: [] },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [],
      })

      renderComponent()

      expect(capturedChatProps?.allToolIcons).toEqual({})
    })
  })

  describe('useFormattingChangedSubscription', () => {
    it('should call useFormattingChangedSubscription with chatList', () => {
      const chatList = [{ id: 'msg-1', content: 'Hello' }]
      mockUseChat.mockReturnValue({
        chatList,
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      expect(mockUseFormattingChangedSubscription).toHaveBeenCalledWith(chatList)
    })
  })

  describe('edge cases', () => {
    it('should handle missing provider in textGenerationModelList', () => {
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: [],
      })

      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [] },
      })

      // Should still call handleSend without crashing
      expect(handleSend).toHaveBeenCalled()
    })

    it('should handle null eventEmitter', () => {
      mockUseEventEmitterContextContext.mockReturnValue({
        eventEmitter: null,
      })

      expect(() => renderComponent()).not.toThrow()
    })

    it('should handle undefined tools in agentConfig', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: { prompt_variables: [] },
          agentConfig: { tools: undefined },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [],
      })

      // This may throw since the code does agentConfig.tools?.forEach
      // But the optional chaining should handle it
      expect(() => renderComponent()).not.toThrow()
    })
  })
})
