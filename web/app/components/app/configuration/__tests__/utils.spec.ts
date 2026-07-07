import type { ModelConfig } from '@/models/debug'
import { AppModeEnum, ModelModeType, Resolution, TransferMethod } from '@/types/app'
import { buildConfigurationFeaturesData, getConfigurationPublishingState, withCollectionIconBasePath } from '../utils'

const createModelConfig = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: 'openai',
  model_id: 'gpt-4o',
  mode: ModelModeType.chat,
  configs: {
    prompt_template: 'Hello',
    prompt_variables: [],
  },
  chat_prompt_config: {
    prompt: [],
  } as ModelConfig['chat_prompt_config'],
  completion_prompt_config: {
    prompt: { text: '' },
    conversation_histories_role: {
      user_prefix: 'user',
      assistant_prefix: 'assistant',
    },
  } as ModelConfig['completion_prompt_config'],
  opening_statement: '',
  more_like_this: { enabled: false },
  suggested_questions: [],
  suggested_questions_after_answer: { enabled: false },
  speech_to_text: { enabled: false },
  text_to_speech: { enabled: false, voice: '', language: '' },
  file_upload: null,
  retriever_resource: { enabled: false },
  sensitive_word_avoidance: { enabled: false },
  annotation_reply: null,
  external_data_tools: [],
  system_parameters: {
    audio_file_size_limit: 1,
    file_size_limit: 1,
    image_file_size_limit: 1,
    video_file_size_limit: 1,
    workflow_file_upload_limit: 1,
  },
  dataSets: [],
  agentConfig: {
    enabled: false,
    strategy: 'react',
    max_iteration: 1,
    tools: [],
  } as ModelConfig['agentConfig'],
  ...overrides,
})

describe('configuration utils', () => {
  describe('withCollectionIconBasePath', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should prefix relative collection icons with the base path', () => {
      const result = withCollectionIconBasePath([
        { id: 'tool-1', icon: '/icons/tool.svg' },
        { id: 'tool-2', icon: '/console/icons/prefixed.svg' },
      ] as never, '/console')

      expect(result[0]!.icon).toBe('/console/icons/tool.svg')
      expect(result[1]!.icon).toBe('/console/icons/prefixed.svg')
    })
  })

  describe('buildConfigurationFeaturesData', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should derive feature toggles and upload fallbacks from model config', () => {
      const result = buildConfigurationFeaturesData(createModelConfig({
        opening_statement: 'Welcome',
        suggested_questions: ['How are you?'],
        file_upload: {
          enabled: true,
          image: {
            enabled: true,
            detail: Resolution.low,
            number_limits: 2,
            transfer_methods: [TransferMethod.local_file],
          },
          allowed_file_types: ['image'],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: [TransferMethod.local_file],
          number_limits: 2,
        },
      }), undefined)

      expect(result.opening).toEqual({
        enabled: true,
        opening_statement: 'Welcome',
        suggested_questions: ['How are you?'],
      })
      expect(result.file).toBeDefined()
      expect(result.file!.enabled).toBe(true)
      expect(result.file!.image!.detail).toBe(Resolution.low)
      expect(result.file!.allowed_file_extensions).toEqual(['.png'])
    })
  })

  describe('getConfigurationPublishingState', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should block publish when advanced completion mode is missing required blocks', () => {
      const result = getConfigurationPublishingState({
        chatPromptConfig: {
          prompt: [],
        } as never,
        completionPromptConfig: {
          prompt: { text: 'Answer' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        } as never,
        hasSetBlockStatus: {
          context: false,
          history: false,
          query: false,
        },
        hasSetContextVar: false,
        hasSelectedDataSets: false,
        isAdvancedMode: true,
        mode: AppModeEnum.CHAT,
        modelModeType: ModelModeType.completion,
        promptTemplate: 'ignored',
      })

      expect(result.promptEmpty).toBe(false)
      expect(result.cannotPublish).toBe(true)
    })

    it('should require a context variable only for completion apps with selected datasets', () => {
      const result = getConfigurationPublishingState({
        chatPromptConfig: {
          prompt: [],
        } as never,
        completionPromptConfig: {
          prompt: { text: 'Completion prompt' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        } as never,
        hasSetBlockStatus: {
          context: false,
          history: true,
          query: true,
        },
        hasSetContextVar: false,
        hasSelectedDataSets: true,
        isAdvancedMode: false,
        mode: AppModeEnum.COMPLETION,
        modelModeType: ModelModeType.completion,
        promptTemplate: 'Prompt',
      })

      expect(result.promptEmpty).toBe(false)
      expect(result.cannotPublish).toBe(false)
      expect(result.contextVarEmpty).toBe(true)
    })

    it('should treat advanced completion chat prompts as empty when every segment is blank', () => {
      const result = getConfigurationPublishingState({
        chatPromptConfig: {
          prompt: [{ text: '' }, { text: '' }],
        } as never,
        completionPromptConfig: {
          prompt: { text: 'ignored' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        } as never,
        hasSetBlockStatus: {
          context: true,
          history: true,
          query: true,
        },
        hasSetContextVar: true,
        hasSelectedDataSets: false,
        isAdvancedMode: true,
        mode: AppModeEnum.COMPLETION,
        modelModeType: ModelModeType.chat,
        promptTemplate: 'ignored',
      })

      expect(result.promptEmpty).toBe(true)
      expect(result.cannotPublish).toBe(true)
    })

    it('should treat advanced completion text prompts as empty when the completion prompt is missing', () => {
      const result = getConfigurationPublishingState({
        chatPromptConfig: {
          prompt: [{ text: 'ignored' }],
        } as never,
        completionPromptConfig: {
          prompt: { text: '' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        } as never,
        hasSetBlockStatus: {
          context: true,
          history: true,
          query: true,
        },
        hasSetContextVar: true,
        hasSelectedDataSets: false,
        isAdvancedMode: true,
        mode: AppModeEnum.COMPLETION,
        modelModeType: ModelModeType.completion,
        promptTemplate: 'ignored',
      })

      expect(result.promptEmpty).toBe(true)
      expect(result.cannotPublish).toBe(true)
    })
  })
})
