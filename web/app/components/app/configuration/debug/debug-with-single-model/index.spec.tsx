import type { ReactNode, RefObject } from 'react'
import type { DebugWithSingleModelRefType } from './index'
import type { ChatItem } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { Collection } from '@/app/components/tools/types'
import type { ProviderContextState } from '@/context/provider-context'
import type { DatasetConfigs, ModelConfig } from '@/models/debug'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ConfigurationMethodEnum, ModelFeatureEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { CollectionType } from '@/app/components/tools/types'
import { PromptMode } from '@/models/debug'
import { AgentStrategy, AppModeEnum, ModelModeType, Resolution, TransferMethod } from '@/types/app'
import DebugWithSingleModel from './index'

// ============================================================================
// Test Data Factories (Following testing.md guidelines)
// ============================================================================

/**
 * Factory function for creating mock ModelConfig with type safety
 */
function createMockModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    provider: 'openai',
    model_id: 'gpt-3.5-turbo',
    mode: ModelModeType.chat,
    configs: {
      prompt_template: 'Test template',
      prompt_variables: [
        { key: 'var1', name: 'Variable 1', type: 'text', required: false },
      ],
    },
    chat_prompt_config: {
      prompt: [],
    },
    completion_prompt_config: {
      prompt: { text: '' },
      conversation_histories_role: {
        user_prefix: 'user',
        assistant_prefix: 'assistant',
      },
    },
    more_like_this: null,
    opening_statement: '',
    suggested_questions: [],
    sensitive_word_avoidance: null,
    speech_to_text: null,
    text_to_speech: null,
    file_upload: null,
    suggested_questions_after_answer: null,
    retriever_resource: null,
    annotation_reply: null,
    external_data_tools: [],
    system_parameters: {
      audio_file_size_limit: 0,
      file_size_limit: 0,
      image_file_size_limit: 0,
      video_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    },
    dataSets: [],
    agentConfig: {
      enabled: false,
      max_iteration: 5,
      tools: [],
      strategy: AgentStrategy.react,
    },
    ...overrides,
  }
}

/**
 * Factory function for creating mock Collection list
 */
function createMockCollections(collections: Partial<Collection>[] = []): Collection[] {
  return collections.map((collection, index) => ({
    id: `collection-${index}`,
    name: `Collection ${index}`,
    icon: 'icon-url',
    type: 'tool',
    ...collection,
  } as Collection))
}

/**
 * Factory function for creating mock Provider Context
 */
function createMockProviderContext(overrides: Partial<ProviderContextState> = {}): ProviderContextState {
  return {
    textGenerationModelList: [
      {
        provider: 'openai',
        label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        status: ModelStatusEnum.active,
        models: [
          {
            model: 'gpt-3.5-turbo',
            label: { en_US: 'GPT-3.5', zh_Hans: 'GPT-3.5' },
            model_type: ModelTypeEnum.textGeneration,
            features: [ModelFeatureEnum.vision],
            fetch_from: ConfigurationMethodEnum.predefinedModel,
            model_properties: {},
            deprecated: false,
          },
        ],
      },
    ],
    hasSettedApiKey: true,
    modelProviders: [],
    speech2textDefaultModel: null,
    ttsDefaultModel: null,
    agentThoughtDefaultModel: null,
    updateModelList: vi.fn(),
    onPlanInfoChanged: vi.fn(),
    refreshModelProviders: vi.fn(),
    refreshLicenseLimit: vi.fn(),
    ...overrides,
  } as ProviderContextState
}

// ============================================================================
// Mock External Dependencies ONLY (Following testing.md guidelines)
// ============================================================================

// Mock service layer (API calls)
const { mockSsePost } = vi.hoisted(() => ({
  mockSsePost: vi.fn<(...args: any[]) => Promise<void>>(() => Promise.resolve()),
}))

vi.mock('@/service/base', () => ({
  ssePost: mockSsePost,
  post: vi.fn(() => Promise.resolve({ data: {} })),
  get: vi.fn(() => Promise.resolve({ data: {} })),
  del: vi.fn(() => Promise.resolve({ data: {} })),
  patch: vi.fn(() => Promise.resolve({ data: {} })),
  put: vi.fn(() => Promise.resolve({ data: {} })),
}))

vi.mock('@/service/fetch', () => ({
  fetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}))

const { mockFetchConversationMessages, mockFetchSuggestedQuestions, mockStopChatMessageResponding } = vi.hoisted(() => ({
  mockFetchConversationMessages: vi.fn(),
  mockFetchSuggestedQuestions: vi.fn(),
  mockStopChatMessageResponding: vi.fn(),
}))

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: mockFetchConversationMessages,
  fetchSuggestedQuestions: mockFetchSuggestedQuestions,
  stopChatMessageResponding: mockStopChatMessageResponding,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
  useParams: () => ({}),
}))

// Mock complex context providers
const mockDebugConfigContext = {
  appId: 'test-app-id',
  isAPIKeySet: true,
  isTrailFinished: false,
  mode: AppModeEnum.CHAT,
  modelModeType: ModelModeType.chat,
  promptMode: PromptMode.simple,
  setPromptMode: vi.fn(),
  isAdvancedMode: false,
  isAgent: false,
  isFunctionCall: false,
  isOpenAI: true,
  collectionList: createMockCollections([
    { id: 'test-provider', name: 'Test Tool', icon: 'icon-url' },
  ]),
  canReturnToSimpleMode: false,
  setCanReturnToSimpleMode: vi.fn(),
  chatPromptConfig: {},
  completionPromptConfig: {},
  currentAdvancedPrompt: [],
  showHistoryModal: vi.fn(),
  conversationHistoriesRole: { user_prefix: 'user', assistant_prefix: 'assistant' },
  setConversationHistoriesRole: vi.fn(),
  setCurrentAdvancedPrompt: vi.fn(),
  hasSetBlockStatus: { context: false, history: false, query: false },
  conversationId: null,
  setConversationId: vi.fn(),
  introduction: '',
  setIntroduction: vi.fn(),
  suggestedQuestions: [],
  setSuggestedQuestions: vi.fn(),
  controlClearChatMessage: 0,
  setControlClearChatMessage: vi.fn(),
  prevPromptConfig: { prompt_template: '', prompt_variables: [] },
  setPrevPromptConfig: vi.fn(),
  moreLikeThisConfig: { enabled: false },
  setMoreLikeThisConfig: vi.fn(),
  suggestedQuestionsAfterAnswerConfig: { enabled: false },
  setSuggestedQuestionsAfterAnswerConfig: vi.fn(),
  speechToTextConfig: { enabled: false },
  setSpeechToTextConfig: vi.fn(),
  textToSpeechConfig: { enabled: false, voice: '', language: '' },
  setTextToSpeechConfig: vi.fn(),
  citationConfig: { enabled: false },
  setCitationConfig: vi.fn(),
  moderationConfig: { enabled: false },
  annotationConfig: { id: '', enabled: false, score_threshold: 0.7, embedding_model: { embedding_model_name: '', embedding_provider_name: '' } },
  setAnnotationConfig: vi.fn(),
  setModerationConfig: vi.fn(),
  externalDataToolsConfig: [],
  setExternalDataToolsConfig: vi.fn(),
  formattingChanged: false,
  setFormattingChanged: vi.fn(),
  inputs: { var1: 'test input' },
  setInputs: vi.fn(),
  query: '',
  setQuery: vi.fn(),
  completionParams: { max_tokens: 100, temperature: 0.7 },
  setCompletionParams: vi.fn(),
  modelConfig: createMockModelConfig({
    agentConfig: {
      enabled: false,
      max_iteration: 5,
      tools: [{
        tool_name: 'test-tool',
        provider_id: 'test-provider',
        provider_type: CollectionType.builtIn,
        provider_name: 'test-provider',
        tool_label: 'Test Tool',
        tool_parameters: {},
        enabled: true,
      }],
      strategy: AgentStrategy.react,
    },
  }),
  setModelConfig: vi.fn(),
  dataSets: [],
  showSelectDataSet: vi.fn(),
  setDataSets: vi.fn(),
  datasetConfigs: {
    retrieval_model: 'single',
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 4,
    score_threshold_enabled: false,
    score_threshold: 0.7,
    datasets: { datasets: [] },
  } as DatasetConfigs,
  datasetConfigsRef: createRef<DatasetConfigs>(),
  setDatasetConfigs: vi.fn(),
  hasSetContextVar: false,
  isShowVisionConfig: false,
  visionConfig: { enabled: false, number_limits: 2, detail: Resolution.low, transfer_methods: [] },
  setVisionConfig: vi.fn(),
  isAllowVideoUpload: false,
  isShowDocumentConfig: false,
  isShowAudioConfig: false,
  rerankSettingModalOpen: false,
  setRerankSettingModalOpen: vi.fn(),
}

const { mockUseDebugConfigurationContext } = vi.hoisted(() => ({
  mockUseDebugConfigurationContext: vi.fn(),
}))

// Set up the default implementation after mockDebugConfigContext is defined
mockUseDebugConfigurationContext.mockReturnValue(mockDebugConfigContext)

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: mockUseDebugConfigurationContext,
}))

const mockProviderContext = createMockProviderContext()

const { mockUseProviderContext } = vi.hoisted(() => ({
  mockUseProviderContext: vi.fn(),
}))

mockUseProviderContext.mockReturnValue(mockProviderContext)

vi.mock('@/context/provider-context', () => ({
  useProviderContext: mockUseProviderContext,
}))

const mockAppContext = {
  userProfile: {
    id: 'user-1',
    avatar_url: 'https://example.com/avatar.png',
    name: 'Test User',
    email: 'test@example.com',
  },
  isCurrentWorkspaceManager: false,
  isCurrentWorkspaceOwner: false,
  isCurrentWorkspaceDatasetOperator: false,
  mutateUserProfile: vi.fn(),
}

const { mockUseAppContext } = vi.hoisted(() => ({
  mockUseAppContext: vi.fn(),
}))

mockUseAppContext.mockReturnValue(mockAppContext)

vi.mock('@/context/app-context', () => ({
  useAppContext: mockUseAppContext,
}))

type FeatureState = {
  moreLikeThis: { enabled: boolean }
  opening: { enabled: boolean, opening_statement: string, suggested_questions: string[] }
  moderation: { enabled: boolean }
  speech2text: { enabled: boolean }
  text2speech: { enabled: boolean }
  file: { enabled: boolean }
  suggested: { enabled: boolean }
  citation: { enabled: boolean }
  annotationReply: { enabled: boolean }
}

const defaultFeatures: FeatureState = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false, opening_statement: '', suggested_questions: [] },
  moderation: { enabled: false },
  speech2text: { enabled: false },
  text2speech: { enabled: false },
  file: { enabled: false },
  suggested: { enabled: false },
  citation: { enabled: false },
  annotationReply: { enabled: false },
}
type FeatureSelector = (state: { features: FeatureState }) => unknown

let mockFeaturesState: FeatureState = { ...defaultFeatures }

const { mockUseFeatures } = vi.hoisted(() => ({
  mockUseFeatures: vi.fn(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: mockUseFeatures,
}))

const mockConfigFromDebugContext = {
  pre_prompt: 'Test prompt',
  prompt_type: 'simple',
  user_input_form: [],
  dataset_query_variable: '',
  opening_statement: '',
  more_like_this: { enabled: false },
  suggested_questions: [],
  suggested_questions_after_answer: { enabled: false },
  text_to_speech: { enabled: false },
  speech_to_text: { enabled: false },
  retriever_resource: { enabled: false },
  sensitive_word_avoidance: { enabled: false },
  agent_mode: {},
  dataset_configs: {},
  file_upload: { enabled: false },
  annotation_reply: { enabled: false },
  supportAnnotation: true,
  appId: 'test-app-id',
  supportCitationHitInfo: true,
}

const { mockUseConfigFromDebugContext, mockUseFormattingChangedSubscription } = vi.hoisted(() => ({
  mockUseConfigFromDebugContext: vi.fn(),
  mockUseFormattingChangedSubscription: vi.fn(),
}))

mockUseConfigFromDebugContext.mockReturnValue(mockConfigFromDebugContext)

vi.mock('../hooks', () => ({
  useConfigFromDebugContext: mockUseConfigFromDebugContext,
  useFormattingChangedSubscription: mockUseFormattingChangedSubscription,
}))

// Use real store - global zustand mock will auto-reset between tests

// Mock event emitter context
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(() => ({
    eventEmitter: null,
  })),
}))

// Mock toast context
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: vi.fn(() => ({
    notify: vi.fn(),
  })),
}))

// Mock hooks/use-timestamp
vi.mock('@/hooks/use-timestamp', () => ({
  default: vi.fn(() => ({
    formatTime: vi.fn((timestamp: number) => new Date(timestamp).toLocaleString()),
  })),
}))

// Mock audio player manager
vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: vi.fn(() => ({
      getAudioPlayer: vi.fn(),
      resetAudioPlayer: vi.fn(),
    })),
  },
}))

type MockChatProps = {
  chatList?: ChatItem[]
  isResponding?: boolean
  onSend?: (message: string, files?: FileEntity[]) => void
  onRegenerate?: (chatItem: ChatItem, editedQuestion?: { message: string, files?: FileEntity[] }) => void
  onStopResponding?: () => void
  suggestedQuestions?: string[]
  questionIcon?: ReactNode
  answerIcon?: ReactNode
  onAnnotationAdded?: (annotationId: string, authorName: string, question: string, answer: string, index: number) => void
  onAnnotationEdited?: (question: string, answer: string, index: number) => void
  onAnnotationRemoved?: (index: number) => void
  switchSibling?: (siblingMessageId: string) => void
  onFeatureBarClick?: (state: boolean) => void
}

const mockFile: FileEntity = {
  id: 'file-1',
  name: 'test.png',
  size: 123,
  type: 'image/png',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'image',
}

// Mock Chat component (complex with many dependencies)
// This is a pragmatic mock that tests the integration at DebugWithSingleModel level
vi.mock('@/app/components/base/chat/chat', () => ({
  default: function MockChat({
    chatList,
    isResponding,
    onSend,
    onRegenerate,
    onStopResponding,
    suggestedQuestions,
    questionIcon,
    answerIcon,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    switchSibling,
    onFeatureBarClick,
  }: MockChatProps) {
    const items = chatList || []
    const suggested = suggestedQuestions ?? []
    return (
      <div data-testid="chat-component">
        <div data-testid="chat-list">
          {items.map((item: ChatItem) => (
            <div key={item.id} data-testid={`chat-item-${item.id}`}>
              {item.content}
            </div>
          ))}
        </div>
        {!!questionIcon && <div data-testid="question-icon">{questionIcon}</div>}
        {!!answerIcon && <div data-testid="answer-icon">{answerIcon}</div>}
        <textarea
          data-testid="chat-input"
          placeholder="Type a message"
          onChange={() => {
            // Simulate input change
          }}
        />
        <button
          data-testid="send-button"
          onClick={() => onSend?.('test message', [])}
          disabled={isResponding}
        >
          Send
        </button>
        <button
          data-testid="send-with-files"
          onClick={() => onSend?.('test message', [mockFile])}
          disabled={isResponding}
        >
          Send With Files
        </button>
        {isResponding && (
          <button data-testid="stop-button" onClick={onStopResponding}>
            Stop
          </button>
        )}
        {suggested.length > 0 && (
          <div data-testid="suggested-questions">
            {suggested.map((q: string, i: number) => (
              <button key={i} onClick={() => onSend?.(q, [])}>
                {q}
              </button>
            ))}
          </div>
        )}
        {onRegenerate && (
          <button
            data-testid="regenerate-button"
            onClick={() => onRegenerate({
              id: 'msg-1',
              content: 'Question',
              isAnswer: false,
              message_files: [],
              parentMessageId: 'msg-0',
            })}
          >
            Regenerate
          </button>
        )}
        {switchSibling && (
          <button
            data-testid="switch-sibling-button"
            onClick={() => switchSibling('sibling-1')}
          >
            Switch
          </button>
        )}
        {onFeatureBarClick && (
          <button
            data-testid="feature-bar-button"
            onClick={() => onFeatureBarClick(true)}
          >
            Features
          </button>
        )}
        {onAnnotationAdded && (
          <button
            data-testid="add-annotation-button"
            onClick={() => onAnnotationAdded('ann-1', 'user', 'q', 'a', 0)}
          >
            Add Annotation
          </button>
        )}
        {onAnnotationEdited && (
          <button
            data-testid="edit-annotation-button"
            onClick={() => onAnnotationEdited('q', 'a', 0)}
          >
            Edit Annotation
          </button>
        )}
        {onAnnotationRemoved && (
          <button
            data-testid="remove-annotation-button"
            onClick={() => onAnnotationRemoved(0)}
          >
            Remove Annotation
          </button>
        )}
      </div>
    )
  },
}))

// ============================================================================
// Tests
// ============================================================================

describe('DebugWithSingleModel', () => {
  let ref: RefObject<DebugWithSingleModelRefType | null>

  beforeEach(() => {
    vi.clearAllMocks()
    ref = createRef<DebugWithSingleModelRefType | null>()

    // Reset mock implementations using module-level mocks
    mockUseDebugConfigurationContext.mockReturnValue(mockDebugConfigContext)
    mockUseProviderContext.mockReturnValue(mockProviderContext)
    mockUseAppContext.mockReturnValue(mockAppContext)
    mockUseConfigFromDebugContext.mockReturnValue(mockConfigFromDebugContext)
    mockUseFormattingChangedSubscription.mockReturnValue(undefined)
    mockFeaturesState = { ...defaultFeatures }
    mockUseFeatures.mockImplementation((selector?: FeatureSelector) => {
      if (typeof selector === 'function')
        return selector({ features: mockFeaturesState })
      return mockFeaturesState
    })

    // Reset mock implementations
    mockFetchConversationMessages.mockResolvedValue({ data: [] })
    mockFetchSuggestedQuestions.mockResolvedValue({ data: [] })
    mockStopChatMessageResponding.mockResolvedValue({})
  })

  // Rendering Tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      // Verify Chat component is rendered
      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
    })

    it('should render with custom checkCanSend prop', () => {
      const checkCanSend = vi.fn(() => true)

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} checkCanSend={checkCanSend} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should respect checkCanSend returning true', async () => {
      const checkCanSend = vi.fn(() => true)

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} checkCanSend={checkCanSend} />)

      const sendButton = screen.getByTestId('send-button')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(checkCanSend).toHaveBeenCalled()
        expect(mockSsePost).toHaveBeenCalled()
      })

      expect(mockSsePost.mock.calls[0][0]).toBe('apps/test-app-id/chat-messages')
    })

    it('should prevent send when checkCanSend returns false', async () => {
      const checkCanSend = vi.fn(() => false)

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} checkCanSend={checkCanSend} />)

      const sendButton = screen.getByTestId('send-button')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(checkCanSend).toHaveBeenCalled()
        expect(checkCanSend).toHaveReturnedWith(false)
      })
      expect(mockSsePost).not.toHaveBeenCalled()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should open feature configuration when feature bar is clicked', () => {
      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      fireEvent.click(screen.getByTestId('feature-bar-button'))

      expect(useAppStore.getState().showAppConfigureFeaturesModal).toBe(true)
    })
  })

  // Model Configuration Tests
  describe('Model Configuration', () => {
    it('should include opening features in request when enabled', async () => {
      mockFeaturesState = {
        ...defaultFeatures,
        opening: { enabled: true, opening_statement: 'Hello!', suggested_questions: ['Q1'] },
      }

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      fireEvent.click(screen.getByTestId('send-button'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0][1].body
      expect(body.model_config.opening_statement).toBe('Hello!')
      expect(body.model_config.suggested_questions).toEqual(['Q1'])
    })

    it('should omit opening statement when feature is disabled', async () => {
      mockFeaturesState = {
        ...defaultFeatures,
        opening: { enabled: false, opening_statement: 'Should not appear', suggested_questions: ['Q1'] },
      }

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      fireEvent.click(screen.getByTestId('send-button'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0][1].body
      expect(body.model_config.opening_statement).toBe('')
      expect(body.model_config.suggested_questions).toEqual([])
    })

    it('should handle model without vision support', () => {
      mockUseProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            status: ModelStatusEnum.active,
            models: [
              {
                model: 'gpt-3.5-turbo',
                label: { en_US: 'GPT-3.5', zh_Hans: 'GPT-3.5' },
                model_type: ModelTypeEnum.textGeneration,
                features: [], // No vision support
                fetch_from: ConfigurationMethodEnum.predefinedModel,
                model_properties: {},
                deprecated: false,
                status: ModelStatusEnum.active,
                load_balancing_enabled: false,
              },
            ],
          },
        ],
      }))

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle missing model in provider list', () => {
      mockUseProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'different-provider',
            label: { en_US: 'Different Provider', zh_Hans: '不同提供商' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            status: ModelStatusEnum.active,
            models: [],
          },
        ],
      }))

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Input Forms Tests
  describe('Input Forms', () => {
    it('should filter out api type prompt variables', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          configs: {
            prompt_template: 'Test',
            prompt_variables: [
              { key: 'var1', name: 'Var 1', type: 'text', required: false },
              { key: 'var2', name: 'Var 2', type: 'api', required: false },
              { key: 'var3', name: 'Var 3', type: 'select', required: false },
            ],
          },
        }),
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      // Component should render successfully with filtered variables
      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle empty prompt variables', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          configs: {
            prompt_template: 'Test',
            prompt_variables: [],
          },
        }),
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Tool Icons Tests
  describe('Tool Icons', () => {
    it('should map tool icons from collection list', () => {
      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle empty tools list', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          agentConfig: {
            enabled: false,
            max_iteration: 5,
            tools: [],
            strategy: AgentStrategy.react,
          },
        }),
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle missing collection for tool', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          agentConfig: {
            enabled: false,
            max_iteration: 5,
            tools: [{
              tool_name: 'unknown-tool',
              provider_id: 'unknown-provider',
              provider_type: CollectionType.builtIn,
              provider_name: 'unknown-provider',
              tool_label: 'Unknown Tool',
              tool_parameters: {},
              enabled: true,
            }],
            strategy: AgentStrategy.react,
          },
        }),
        collectionList: [],
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Edge Cases
  describe('Edge Cases', () => {
    it('should handle empty inputs', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        inputs: {} as any,
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle missing user profile', () => {
      mockUseAppContext.mockReturnValue({
        ...mockAppContext,
        userProfile: {
          id: '',
          avatar_url: '',
          name: '',
          email: '',
        },
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle null completion params', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        completionParams: {} as any,
      })

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Imperative Handle Tests
  describe('Imperative Handle', () => {
    it('should expose handleRestart method via ref', () => {
      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      expect(ref.current).not.toBeNull()
      expect(ref.current?.handleRestart).toBeDefined()
      expect(typeof ref.current?.handleRestart).toBe('function')
    })

    it('should call handleRestart when invoked via ref', () => {
      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      act(() => {
        ref.current?.handleRestart()
      })
    })
  })

  // File Upload Tests
  describe('File Upload', () => {
    it('should not include files when vision is not supported', async () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          model_id: 'gpt-3.5-turbo',
        }),
      })

      mockUseProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            status: ModelStatusEnum.active,
            models: [
              {
                model: 'gpt-3.5-turbo',
                label: { en_US: 'GPT-3.5', zh_Hans: 'GPT-3.5' },
                model_type: ModelTypeEnum.textGeneration,
                features: [], // No vision
                fetch_from: ConfigurationMethodEnum.predefinedModel,
                model_properties: {},
                deprecated: false,
                status: ModelStatusEnum.active,
                load_balancing_enabled: false,
              },
            ],
          },
        ],
      }))

      mockFeaturesState = {
        ...defaultFeatures,
        file: { enabled: true },
      }

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      fireEvent.click(screen.getByTestId('send-with-files'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0][1].body
      expect(body.files).toEqual([])
    })

    it('should support files when vision is enabled', async () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          model_id: 'gpt-4-vision',
        }),
      })

      mockUseProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            status: ModelStatusEnum.active,
            models: [
              {
                model: 'gpt-4-vision',
                label: { en_US: 'GPT-4 Vision', zh_Hans: 'GPT-4 Vision' },
                model_type: ModelTypeEnum.textGeneration,
                features: [ModelFeatureEnum.vision],
                fetch_from: ConfigurationMethodEnum.predefinedModel,
                model_properties: {},
                deprecated: false,
                status: ModelStatusEnum.active,
                load_balancing_enabled: false,
              },
            ],
          },
        ],
      }))

      mockFeaturesState = {
        ...defaultFeatures,
        file: { enabled: true },
      }

      render(<DebugWithSingleModel ref={ref as RefObject<DebugWithSingleModelRefType>} />)

      fireEvent.click(screen.getByTestId('send-with-files'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0][1].body
      expect(body.files).toHaveLength(1)
    })
  })
})
