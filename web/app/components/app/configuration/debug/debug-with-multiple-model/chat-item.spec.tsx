import type { ModelAndParameter } from '../types'
import type { ChatConfig } from '@/app/components/base/chat/types'
import { render, screen, waitFor } from '@testing-library/react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { ModelModeType } from '@/types/app'
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
  useFeatures: (selector: (state: unknown) => unknown) => mockUseFeatures(selector),
}))

vi.mock('../hooks', () => ({
  useConfigFromDebugContext: () => mockUseConfigFromDebugContext(),
  useFormattingChangedSubscription: (chatList: unknown) => mockUseFormattingChangedSubscription(chatList),
}))

vi.mock('@/app/components/base/chat/chat/hooks', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

const mockStopChatMessageResponding = vi.fn()
const mockFetchConversationMessages = vi.fn()
const mockFetchSuggestedQuestions = vi.fn()

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: (...args: unknown[]) => mockFetchConversationMessages(...args),
  fetchSuggestedQuestions: (...args: unknown[]) => mockFetchSuggestedQuestions(...args),
  stopChatMessageResponding: (...args: unknown[]) => mockStopChatMessageResponding(...args),
}))

vi.mock('@/utils', () => ({
  canFindTool: (collectionId: string, providerId: string) => collectionId === providerId,
}))

vi.mock('@/app/components/base/chat/utils', () => ({
  getLastAnswer: (chatList: { id: string }[]) => chatList.length > 0 ? chatList[chatList.length - 1] : null,
}))

let capturedChatProps: Record<string, unknown> | null = null
vi.mock('@/app/components/base/chat/chat', () => ({
  default: (props: Record<string, unknown>) => {
    capturedChatProps = props
    return <div data-testid="chat-component">Chat</div>
  },
}))

vi.mock('@/app/components/base/avatar', () => ({
  default: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
}))

let modelIdCounter = 0

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: `model-${++modelIdCounter}`,
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const createDefaultModelConfig = () => ({
  provider: 'openai',
  model_id: 'gpt-4',
  mode: ModelModeType.chat,
  configs: {
    prompt_template: 'Hello {{name}}',
    prompt_variables: [
      { key: 'name', name: 'Name', type: 'string' as const },
      { key: 'api-var', name: 'API Var', type: 'api' as const },
    ],
  },
  chat_prompt_config: DEFAULT_CHAT_PROMPT_CONFIG,
  completion_prompt_config: DEFAULT_COMPLETION_PROMPT_CONFIG,
  opening_statement: '',
  more_like_this: null,
  suggested_questions: [],
  suggested_questions_after_answer: null,
  speech_to_text: null,
  text_to_speech: null,
  file_upload: null,
  retriever_resource: null,
  sensitive_word_avoidance: null,
  annotation_reply: null,
  external_data_tools: [],
  dataSets: [],
  agentConfig: DEFAULT_AGENT_SETTING,
  system_parameters: {
    audio_file_size_limit: 0,
    file_size_limit: 0,
    image_file_size_limit: 0,
    video_file_size_limit: 0,
    workflow_file_upload_limit: 0,
  },
})

const createDefaultFeatures = () => ({
  moreLikeThis: { enabled: false },
  opening: { enabled: true, opening_statement: 'Hello', suggested_questions: ['Q1'] },
  moderation: { enabled: false },
  speech2text: { enabled: true },
  text2speech: { enabled: false },
  file: { enabled: true, image: { enabled: true } },
  suggested: { enabled: true },
  citation: { enabled: false },
  annotationReply: { enabled: false },
})

const createTextGenerationModelList = (models: Array<{
  provider: string
  model: string
  features?: string[]
  mode?: string
}> = []) => {
  const providerMap = new Map<string, { model: string, features: string[], model_properties: { mode: string } }[]>()

  for (const m of models) {
    if (!providerMap.has(m.provider)) {
      providerMap.set(m.provider, [])
    }
    providerMap.get(m.provider)!.push({
      model: m.model,
      features: m.features ?? [],
      model_properties: { mode: m.mode ?? 'chat' },
    })
  }

  return Array.from(providerMap.entries()).map(([provider, modelsList]) => ({
    provider,
    models: modelsList,
  }))
}

describe('ChatItem', () => {
  let subscriptionCallback: ((v: { type: string, payload?: { message: string, files?: unknown[] } }) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    modelIdCounter = 0
    capturedChatProps = null
    subscriptionCallback = null

    mockUseAppContext.mockReturnValue({
      userProfile: { avatar_url: 'avatar.png', name: 'Test User' },
    })

    mockUseDebugConfigurationContext.mockReturnValue({
      modelConfig: createDefaultModelConfig(),
      appId: 'test-app-id',
      inputs: { name: 'World' },
      collectionList: [],
    })

    mockUseProviderContext.mockReturnValue({
      textGenerationModelList: createTextGenerationModelList([
        { provider: 'openai', model: 'gpt-3.5-turbo', features: [ModelFeatureEnum.vision], mode: 'chat' },
        { provider: 'openai', model: 'gpt-4', features: [], mode: 'chat' },
      ]),
    })

    const features = createDefaultFeatures()
    mockUseFeatures.mockImplementation((selector: (state: { features: ReturnType<typeof createDefaultFeatures> }) => unknown) => selector({ features }))

    mockUseConfigFromDebugContext.mockReturnValue({
      baseConfig: true,
    })

    mockUseChat.mockReturnValue({
      chatList: [{ id: 'msg-1', content: 'Hello' }],
      isResponding: false,
      handleSend: vi.fn(),
      suggestedQuestions: [],
      handleRestart: vi.fn(),
    })

    mockUseEventEmitterContextContext.mockReturnValue({
      eventEmitter: {
        // eslint-disable-next-line react/no-unnecessary-use-prefix -- mocking real API
        useSubscription: (callback: (v: { type: string, payload?: { message: string, files?: unknown[] } }) => void) => {
          subscriptionCallback = callback
        },
      },
    })
  })

  describe('rendering', () => {
    it('should render Chat component when chatList is not empty', () => {
      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should return null when chatList is empty', () => {
      mockUseChat.mockReturnValue({
        chatList: [],
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter()

      const { container } = render(<ChatItem modelAndParameter={modelAndParameter} />)

      expect(container.firstChild).toBeNull()
    })

    it('should pass correct props to Chat component', () => {
      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      expect(capturedChatProps!.noChatInput).toBe(true)
      expect(capturedChatProps!.noStopResponding).toBe(true)
      expect(capturedChatProps!.showPromptLog).toBe(true)
      expect(capturedChatProps!.hideLogModal).toBe(true)
      expect(capturedChatProps!.noSpacing).toBe(true)
      expect(capturedChatProps!.chatContainerClassName).toBe('p-4')
      expect(capturedChatProps!.chatFooterClassName).toBe('p-4 pb-0')
    })
  })

  describe('config building', () => {
    it('should merge configTemplate with features', () => {
      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const config = capturedChatProps!.config as ChatConfig & { baseConfig?: boolean }
      expect(config.baseConfig).toBe(true)
      expect(config.more_like_this).toEqual({ enabled: false })
      expect(config.opening_statement).toBe('Hello')
      expect(config.suggested_questions).toEqual(['Q1'])
      expect(config.speech_to_text).toEqual({ enabled: true })
      expect(config.file_upload).toEqual({ enabled: true, image: { enabled: true } })
    })

    it('should use empty opening_statement when opening is disabled', () => {
      const features = createDefaultFeatures()
      features.opening = { enabled: false, opening_statement: 'Hello', suggested_questions: ['Q1'] }
      mockUseFeatures.mockImplementation((selector: (state: { features: ReturnType<typeof createDefaultFeatures> }) => unknown) => selector({ features }))

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const config = capturedChatProps!.config as ChatConfig
      expect(config.opening_statement).toBe('')
      expect(config.suggested_questions).toEqual([])
    })

    it('should use empty string fallback when opening_statement is undefined', () => {
      const features = createDefaultFeatures()
      // eslint-disable-next-line ts/no-explicit-any -- Testing edge case with undefined
      features.opening = { enabled: true, opening_statement: undefined as any, suggested_questions: ['Q1'] }
      mockUseFeatures.mockImplementation((selector: (state: { features: ReturnType<typeof createDefaultFeatures> }) => unknown) => selector({ features }))

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const config = capturedChatProps!.config as ChatConfig
      expect(config.opening_statement).toBe('')
    })

    it('should use empty array fallback when suggested_questions is undefined', () => {
      const features = createDefaultFeatures()
      // eslint-disable-next-line ts/no-explicit-any -- Testing edge case with undefined
      features.opening = { enabled: true, opening_statement: 'Hello', suggested_questions: undefined as any }
      mockUseFeatures.mockImplementation((selector: (state: { features: ReturnType<typeof createDefaultFeatures> }) => unknown) => selector({ features }))

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const config = capturedChatProps!.config as ChatConfig
      expect(config.suggested_questions).toEqual([])
    })

    it('should handle undefined opening feature', () => {
      const features = createDefaultFeatures()
      // eslint-disable-next-line ts/no-explicit-any -- Testing edge case with undefined
      features.opening = undefined as any
      mockUseFeatures.mockImplementation((selector: (state: { features: ReturnType<typeof createDefaultFeatures> }) => unknown) => selector({ features }))

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const config = capturedChatProps!.config as ChatConfig
      expect(config.opening_statement).toBe('')
      expect(config.suggested_questions).toEqual([])
    })
  })

  describe('inputsForm transformation', () => {
    it('should filter out api type variables and map to InputForm', () => {
      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      // The useChat is called with inputsForm
      const useChatCall = mockUseChat.mock.calls[0]
      const inputsForm = useChatCall[1].inputsForm

      expect(inputsForm).toHaveLength(1)
      expect(inputsForm[0]).toEqual(expect.objectContaining({
        key: 'name',
        label: 'Name',
        variable: 'name',
      }))
    })
  })

  describe('event subscription', () => {
    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL event', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      // Trigger the event
      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test message', files: [{ id: 'file-1' }] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalled()
      })
    })

    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL_RESTART event', async () => {
      const handleRestart = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart,
      })

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      // Trigger the event
      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
      })

      await waitFor(() => {
        expect(handleRestart).toHaveBeenCalled()
      })
    })
  })

  describe('doSend', () => {
    it('should find current provider and model from textGenerationModelList', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-3.5-turbo' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalledWith(
          'apps/test-app-id/chat-messages',
          expect.objectContaining({
            query: 'test',
            inputs: { name: 'World' },
            model_config: expect.objectContaining({
              model: expect.objectContaining({
                provider: 'openai',
                name: 'gpt-3.5-turbo',
                mode: 'chat',
              }),
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should include files when file upload is enabled and vision is supported', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      // gpt-3.5-turbo has vision feature
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-3.5-turbo' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const files = [{ id: 'file-1', name: 'image.png' }]
      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            files,
          }),
          expect.any(Object),
        )
      })
    })

    it('should not include files when vision is not supported', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      // gpt-4 does not have vision feature
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      const files = [{ id: 'file-1', name: 'image.png' }]
      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files },
      })

      await waitFor(() => {
        const callArgs = handleSend.mock.calls[0][1]
        expect(callArgs.files).toBeUndefined()
      })
    })

    it('should handle provider not found in textGenerationModelList', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      // Use a provider that doesn't exist in the list
      const modelAndParameter = createModelAndParameter({ provider: 'unknown-provider', model: 'unknown-model' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [{ id: 'file-1' }] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalled()
        const callArgs = handleSend.mock.calls[0][1]
        // Files should not be included when provider/model not found (no vision support)
        expect(callArgs.files).toBeUndefined()
      })
    })

    it('should handle model with no features array', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      // Model list where model has no features property
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: [
          {
            provider: 'custom',
            models: [{ model: 'custom-model', model_properties: { mode: 'chat' } }],
          },
        ],
      })

      const modelAndParameter = createModelAndParameter({ provider: 'custom', model: 'custom-model' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [{ id: 'file-1' }] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalled()
        const callArgs = handleSend.mock.calls[0][1]
        // Files should not be included when features is undefined
        expect(callArgs.files).toBeUndefined()
      })
    })

    it('should handle undefined files parameter', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-3.5-turbo' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: undefined },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalled()
        const callArgs = handleSend.mock.calls[0][1]
        expect(callArgs.files).toBeUndefined()
      })
    })
  })

  describe('tool icons building', () => {
    it('should build tool icons from agent config', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          ...createDefaultModelConfig(),
          agentConfig: {
            tools: [
              { tool_name: 'search', provider_id: 'provider-1' },
              { tool_name: 'calculator', provider_id: 'provider-2' },
            ],
          },
        },
        appId: 'test-app-id',
        inputs: {},
        collectionList: [
          { id: 'provider-1', icon: 'search-icon' },
          { id: 'provider-2', icon: 'calc-icon' },
        ],
      })

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      expect(capturedChatProps!.allToolIcons).toEqual({
        search: 'search-icon',
        calculator: 'calc-icon',
      })
    })

    it('should handle missing tools gracefully', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          ...createDefaultModelConfig(),
          agentConfig: {
            tools: undefined,
          },
        },
        appId: 'test-app-id',
        inputs: {},
        collectionList: [],
      })

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      expect(capturedChatProps!.allToolIcons).toEqual({})
    })
  })

  describe('useFormattingChangedSubscription', () => {
    it('should call useFormattingChangedSubscription with chatList', () => {
      const chatList = [{ id: 'msg-1' }, { id: 'msg-2' }]
      mockUseChat.mockReturnValue({
        chatList,
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      expect(mockUseFormattingChangedSubscription).toHaveBeenCalledWith(chatList)
    })
  })

  describe('useChat callbacks', () => {
    it('should pass stopChatMessageResponding callback to useChat', () => {
      const modelAndParameter = createModelAndParameter()

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      // Get the stopResponding callback passed to useChat (4th argument)
      const useChatCall = mockUseChat.mock.calls[0]
      const stopRespondingCallback = useChatCall[3]

      // Invoke it with a taskId
      stopRespondingCallback('test-task-id')

      expect(mockStopChatMessageResponding).toHaveBeenCalledWith('test-app-id', 'test-task-id')
    })

    it('should pass onGetConversationMessages callback to handleSend', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-3.5-turbo' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalled()
      })

      // Get the callbacks object (3rd argument to handleSend)
      const callbacks = handleSend.mock.calls[0][2]

      // Invoke onGetConversationMessages
      const mockGetAbortController = vi.fn()
      callbacks.onGetConversationMessages('conv-123', mockGetAbortController)

      expect(mockFetchConversationMessages).toHaveBeenCalledWith('test-app-id', 'conv-123', mockGetAbortController)
    })

    it('should pass onGetSuggestedQuestions callback to handleSend', async () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-3.5-turbo' })

      render(<ChatItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalled()
      })

      // Get the callbacks object (3rd argument to handleSend)
      const callbacks = handleSend.mock.calls[0][2]

      // Invoke onGetSuggestedQuestions
      const mockGetAbortController = vi.fn()
      callbacks.onGetSuggestedQuestions('response-item-123', mockGetAbortController)

      expect(mockFetchSuggestedQuestions).toHaveBeenCalledWith('test-app-id', 'response-item-123', mockGetAbortController)
    })
  })
})
