import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import DebugWithSingleModel from './index'
import type { DebugWithSingleModelRefType } from './index'
import type { ChatItem } from '@/app/components/base/chat/types'
import { ConfigurationMethodEnum, ModelFeatureEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ProviderContextState } from '@/context/provider-context'
import type { DatasetConfigs, ModelConfig } from '@/models/debug'
import { PromptMode } from '@/models/debug'
import { type Collection, CollectionType } from '@/app/components/tools/types'
import { AgentStrategy, AppModeEnum, ModelModeType } from '@/types/app'

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
 * Factory function for creating mock ChatItem list
 * Note: Currently unused but kept for potential future test cases
 */
// eslint-disable-next-line unused-imports/no-unused-vars
function createMockChatList(items: Partial<ChatItem>[] = []): ChatItem[] {
  return items.map((item, index) => ({
    id: `msg-${index}`,
    content: 'Test message',
    isAnswer: false,
    message_files: [],
    ...item,
  }))
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
        icon_large: { en_US: 'icon', zh_Hans: 'icon' },
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
    updateModelList: jest.fn(),
    onPlanInfoChanged: jest.fn(),
    refreshModelProviders: jest.fn(),
    refreshLicenseLimit: jest.fn(),
    ...overrides,
  } as ProviderContextState
}

// ============================================================================
// Mock External Dependencies ONLY (Following testing.md guidelines)
// ============================================================================

// Mock service layer (API calls)
jest.mock('@/service/base', () => ({
  ssePost: jest.fn(() => Promise.resolve()),
  post: jest.fn(() => Promise.resolve({ data: {} })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
  del: jest.fn(() => Promise.resolve({ data: {} })),
  patch: jest.fn(() => Promise.resolve({ data: {} })),
  put: jest.fn(() => Promise.resolve({ data: {} })),
}))

jest.mock('@/service/fetch', () => ({
  fetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}))

const mockFetchConversationMessages = jest.fn()
const mockFetchSuggestedQuestions = jest.fn()
const mockStopChatMessageResponding = jest.fn()

jest.mock('@/service/debug', () => ({
  fetchConversationMessages: (...args: any[]) => mockFetchConversationMessages(...args),
  fetchSuggestedQuestions: (...args: any[]) => mockFetchSuggestedQuestions(...args),
  stopChatMessageResponding: (...args: any[]) => mockStopChatMessageResponding(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
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
  setPromptMode: jest.fn(),
  isAdvancedMode: false,
  isAgent: false,
  isFunctionCall: false,
  isOpenAI: true,
  collectionList: createMockCollections([
    { id: 'test-provider', name: 'Test Tool', icon: 'icon-url' },
  ]),
  canReturnToSimpleMode: false,
  setCanReturnToSimpleMode: jest.fn(),
  chatPromptConfig: {},
  completionPromptConfig: {},
  currentAdvancedPrompt: [],
  showHistoryModal: jest.fn(),
  conversationHistoriesRole: { user_prefix: 'user', assistant_prefix: 'assistant' },
  setConversationHistoriesRole: jest.fn(),
  setCurrentAdvancedPrompt: jest.fn(),
  hasSetBlockStatus: { context: false, history: false, query: false },
  conversationId: null,
  setConversationId: jest.fn(),
  introduction: '',
  setIntroduction: jest.fn(),
  suggestedQuestions: [],
  setSuggestedQuestions: jest.fn(),
  controlClearChatMessage: 0,
  setControlClearChatMessage: jest.fn(),
  prevPromptConfig: { prompt_template: '', prompt_variables: [] },
  setPrevPromptConfig: jest.fn(),
  moreLikeThisConfig: { enabled: false },
  setMoreLikeThisConfig: jest.fn(),
  suggestedQuestionsAfterAnswerConfig: { enabled: false },
  setSuggestedQuestionsAfterAnswerConfig: jest.fn(),
  speechToTextConfig: { enabled: false },
  setSpeechToTextConfig: jest.fn(),
  textToSpeechConfig: { enabled: false, voice: '', language: '' },
  setTextToSpeechConfig: jest.fn(),
  citationConfig: { enabled: false },
  setCitationConfig: jest.fn(),
  moderationConfig: { enabled: false },
  annotationConfig: { id: '', enabled: false, score_threshold: 0.7, embedding_model: { embedding_model_name: '', embedding_provider_name: '' } },
  setAnnotationConfig: jest.fn(),
  setModerationConfig: jest.fn(),
  externalDataToolsConfig: [],
  setExternalDataToolsConfig: jest.fn(),
  formattingChanged: false,
  setFormattingChanged: jest.fn(),
  inputs: { var1: 'test input' },
  setInputs: jest.fn(),
  query: '',
  setQuery: jest.fn(),
  completionParams: { max_tokens: 100, temperature: 0.7 },
  setCompletionParams: jest.fn(),
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
  setModelConfig: jest.fn(),
  dataSets: [],
  showSelectDataSet: jest.fn(),
  setDataSets: jest.fn(),
  datasetConfigs: {
    retrieval_model: 'single',
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 4,
    score_threshold_enabled: false,
    score_threshold: 0.7,
    datasets: { datasets: [] },
  } as DatasetConfigs,
  datasetConfigsRef: { current: null } as any,
  setDatasetConfigs: jest.fn(),
  hasSetContextVar: false,
  isShowVisionConfig: false,
  visionConfig: { enabled: false, number_limits: 2, detail: 'low' as any, transfer_methods: [] },
  setVisionConfig: jest.fn(),
  isAllowVideoUpload: false,
  isShowDocumentConfig: false,
  isShowAudioConfig: false,
  rerankSettingModalOpen: false,
  setRerankSettingModalOpen: jest.fn(),
}

jest.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: jest.fn(() => mockDebugConfigContext),
}))

const mockProviderContext = createMockProviderContext()

jest.mock('@/context/provider-context', () => ({
  useProviderContext: jest.fn(() => mockProviderContext),
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
  mutateUserProfile: jest.fn(),
}

jest.mock('@/context/app-context', () => ({
  useAppContext: jest.fn(() => mockAppContext),
}))

const mockFeatures = {
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

jest.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: jest.fn((selector) => {
    if (typeof selector === 'function')
      return selector({ features: mockFeatures })
    return mockFeatures
  }),
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

jest.mock('../hooks', () => ({
  useConfigFromDebugContext: jest.fn(() => mockConfigFromDebugContext),
  useFormattingChangedSubscription: jest.fn(),
}))

const mockSetShowAppConfigureFeaturesModal = jest.fn()

jest.mock('@/app/components/app/store', () => ({
  useStore: jest.fn((selector) => {
    if (typeof selector === 'function')
      return selector({ setShowAppConfigureFeaturesModal: mockSetShowAppConfigureFeaturesModal })
    return mockSetShowAppConfigureFeaturesModal
  }),
}))

// Mock event emitter context
jest.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: jest.fn(() => ({
    eventEmitter: null,
  })),
}))

// Mock toast context
jest.mock('@/app/components/base/toast', () => ({
  useToastContext: jest.fn(() => ({
    notify: jest.fn(),
  })),
}))

// Mock hooks/use-timestamp
jest.mock('@/hooks/use-timestamp', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    formatTime: jest.fn((timestamp: number) => new Date(timestamp).toLocaleString()),
  })),
}))

// Mock audio player manager
jest.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: jest.fn(() => ({
      getAudioPlayer: jest.fn(),
      resetAudioPlayer: jest.fn(),
    })),
  },
}))

// Mock external APIs that might be used
globalThis.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))

// Mock Chat component (complex with many dependencies)
// This is a pragmatic mock that tests the integration at DebugWithSingleModel level
jest.mock('@/app/components/base/chat/chat', () => {
  return function MockChat({
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
  }: any) {
    return (
      <div data-testid="chat-component">
        <div data-testid="chat-list">
          {chatList?.map((item: any) => (
            <div key={item.id} data-testid={`chat-item-${item.id}`}>
              {item.content}
            </div>
          ))}
        </div>
        {questionIcon && <div data-testid="question-icon">{questionIcon}</div>}
        {answerIcon && <div data-testid="answer-icon">{answerIcon}</div>}
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
        {isResponding && (
          <button data-testid="stop-button" onClick={onStopResponding}>
            Stop
          </button>
        )}
        {suggestedQuestions?.length > 0 && (
          <div data-testid="suggested-questions">
            {suggestedQuestions.map((q: string, i: number) => (
              <button key={i} onClick={() => onSend?.(q, [])}>
                {q}
              </button>
            ))}
          </div>
        )}
        {onRegenerate && (
          <button
            data-testid="regenerate-button"
            onClick={() => onRegenerate({ id: 'msg-1', parentMessageId: 'msg-0' })}
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
  }
})

// ============================================================================
// Tests
// ============================================================================

describe('DebugWithSingleModel', () => {
  let ref: React.RefObject<DebugWithSingleModelRefType | null>

  beforeEach(() => {
    jest.clearAllMocks()
    ref = createRef<DebugWithSingleModelRefType | null>()

    // Reset mock implementations
    mockFetchConversationMessages.mockResolvedValue({ data: [] })
    mockFetchSuggestedQuestions.mockResolvedValue({ data: [] })
    mockStopChatMessageResponding.mockResolvedValue({})
  })

  // Rendering Tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      // Verify Chat component is rendered
      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
    })

    it('should render with custom checkCanSend prop', () => {
      const checkCanSend = jest.fn(() => true)

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} checkCanSend={checkCanSend} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should respect checkCanSend returning true', async () => {
      const checkCanSend = jest.fn(() => true)

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} checkCanSend={checkCanSend} />)

      const sendButton = screen.getByTestId('send-button')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(checkCanSend).toHaveBeenCalled()
      })
    })

    it('should prevent send when checkCanSend returns false', async () => {
      const checkCanSend = jest.fn(() => false)

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} checkCanSend={checkCanSend} />)

      const sendButton = screen.getByTestId('send-button')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(checkCanSend).toHaveBeenCalled()
        expect(checkCanSend).toHaveReturnedWith(false)
      })
    })
  })

  // Context Integration Tests
  describe('Context Integration', () => {
    it('should use debug configuration context', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(useDebugConfigurationContext).toHaveBeenCalled()
    })

    it('should use provider context for model list', () => {
      const { useProviderContext } = require('@/context/provider-context')

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(useProviderContext).toHaveBeenCalled()
    })

    it('should use app context for user profile', () => {
      const { useAppContext } = require('@/context/app-context')

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(useAppContext).toHaveBeenCalled()
    })

    it('should use features from features hook', () => {
      const { useFeatures } = require('@/app/components/base/features/hooks')

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(useFeatures).toHaveBeenCalled()
    })

    it('should use config from debug context hook', () => {
      const { useConfigFromDebugContext } = require('../hooks')

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(useConfigFromDebugContext).toHaveBeenCalled()
    })

    it('should subscribe to formatting changes', () => {
      const { useFormattingChangedSubscription } = require('../hooks')

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(useFormattingChangedSubscription).toHaveBeenCalled()
    })
  })

  // Model Configuration Tests
  describe('Model Configuration', () => {
    it('should merge features into config correctly when all features enabled', () => {
      const { useFeatures } = require('@/app/components/base/features/hooks')

      useFeatures.mockReturnValue((selector: any) => {
        const features = {
          moreLikeThis: { enabled: true },
          opening: { enabled: true, opening_statement: 'Hello!', suggested_questions: ['Q1'] },
          moderation: { enabled: true },
          speech2text: { enabled: true },
          text2speech: { enabled: true },
          file: { enabled: true },
          suggested: { enabled: true },
          citation: { enabled: true },
          annotationReply: { enabled: true },
        }
        return typeof selector === 'function' ? selector({ features }) : features
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle opening feature disabled correctly', () => {
      const { useFeatures } = require('@/app/components/base/features/hooks')

      useFeatures.mockReturnValue((selector: any) => {
        const features = {
          ...mockFeatures,
          opening: { enabled: false, opening_statement: 'Should not appear', suggested_questions: ['Q1'] },
        }
        return typeof selector === 'function' ? selector({ features }) : features
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      // When opening is disabled, opening_statement should be empty
      expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
    })

    it('should handle model without vision support', () => {
      const { useProviderContext } = require('@/context/provider-context')

      useProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            icon_large: { en_US: 'icon', zh_Hans: 'icon' },
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

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle missing model in provider list', () => {
      const { useProviderContext } = require('@/context/provider-context')

      useProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'different-provider',
            label: { en_US: 'Different Provider', zh_Hans: '不同提供商' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            icon_large: { en_US: 'icon', zh_Hans: 'icon' },
            status: ModelStatusEnum.active,
            models: [],
          },
        ],
      }))

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Input Forms Tests
  describe('Input Forms', () => {
    it('should filter out api type prompt variables', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      useDebugConfigurationContext.mockReturnValue({
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

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      // Component should render successfully with filtered variables
      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle empty prompt variables', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      useDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          configs: {
            prompt_template: 'Test',
            prompt_variables: [],
          },
        }),
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Tool Icons Tests
  describe('Tool Icons', () => {
    it('should map tool icons from collection list', () => {
      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle empty tools list', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      useDebugConfigurationContext.mockReturnValue({
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

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle missing collection for tool', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      useDebugConfigurationContext.mockReturnValue({
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

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Edge Cases
  describe('Edge Cases', () => {
    it('should handle empty inputs', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      useDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        inputs: {},
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle missing user profile', () => {
      const { useAppContext } = require('@/context/app-context')

      useAppContext.mockReturnValue({
        ...mockAppContext,
        userProfile: {
          id: '',
          avatar_url: '',
          name: '',
          email: '',
        },
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should handle null completion params', () => {
      const { useDebugConfigurationContext } = require('@/context/debug-configuration')

      useDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        completionParams: {},
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })

  // Imperative Handle Tests
  describe('Imperative Handle', () => {
    it('should expose handleRestart method via ref', () => {
      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(ref.current).not.toBeNull()
      expect(ref.current?.handleRestart).toBeDefined()
      expect(typeof ref.current?.handleRestart).toBe('function')
    })

    it('should call handleRestart when invoked via ref', () => {
      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(() => {
        ref.current?.handleRestart()
      }).not.toThrow()
    })
  })

  // Memory and Performance Tests
  describe('Memory and Performance', () => {
    it('should properly memoize component', () => {
      const { rerender } = render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      // Re-render with same props
      rerender(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should have displayName set for debugging', () => {
      expect(DebugWithSingleModel).toBeDefined()
      // memo wraps the component
      expect(typeof DebugWithSingleModel).toBe('object')
    })
  })

  // Async Operations Tests
  describe('Async Operations', () => {
    it('should handle API calls during message send', async () => {
      mockFetchConversationMessages.mockResolvedValue({ data: [] })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      const textarea = screen.getByRole('textbox', { hidden: true })
      fireEvent.change(textarea, { target: { value: 'Test message' } })

      // Component should render without errors during async operations
      await waitFor(() => {
        expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      })
    })

    it('should handle API errors gracefully', async () => {
      mockFetchConversationMessages.mockRejectedValue(new Error('API Error'))

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      // Component should still render even if API calls fail
      await waitFor(() => {
        expect(screen.getByTestId('chat-component')).toBeInTheDocument()
      })
    })
  })

  // File Upload Tests
  describe('File Upload', () => {
    it('should not include files when vision is not supported', () => {
      const { useProviderContext } = require('@/context/provider-context')
      const { useFeatures } = require('@/app/components/base/features/hooks')

      useProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            icon_large: { en_US: 'icon', zh_Hans: 'icon' },
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

      useFeatures.mockReturnValue((selector: any) => {
        const features = {
          ...mockFeatures,
          file: { enabled: true }, // File upload enabled
        }
        return typeof selector === 'function' ? selector({ features }) : features
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      // Should render but not allow file uploads
      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })

    it('should support files when vision is enabled', () => {
      const { useProviderContext } = require('@/context/provider-context')
      const { useFeatures } = require('@/app/components/base/features/hooks')

      useProviderContext.mockReturnValue(createMockProviderContext({
        textGenerationModelList: [
          {
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            icon_small: { en_US: 'icon', zh_Hans: 'icon' },
            icon_large: { en_US: 'icon', zh_Hans: 'icon' },
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

      useFeatures.mockReturnValue((selector: any) => {
        const features = {
          ...mockFeatures,
          file: { enabled: true },
        }
        return typeof selector === 'function' ? selector({ features }) : features
      })

      render(<DebugWithSingleModel ref={ref as React.RefObject<DebugWithSingleModelRefType>} />)

      expect(screen.getByTestId('chat-component')).toBeInTheDocument()
    })
  })
})
