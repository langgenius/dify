import { CollectionType } from '@/app/components/tools/types'
import { createModelConfigFixture as createModelConfig } from '@/test/fixtures/debug-configuration'
import { ModelModeType, Resolution, TransferMethod } from '@/types/app'
import {
  buildConfigurationFeaturesData,
  getConfigurationPublishingState,
  withCollectionIconBasePath,
} from '../utils'

const createCollection = (id: string, icon: string) => ({
  id,
  icon,
  name: id,
  author: 'Dify',
  description: { en_US: '', zh_Hans: '' },
  label: { en_US: id, zh_Hans: id },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
})

describe('configuration utils', () => {
  describe('withCollectionIconBasePath', () => {
    it('should prefix relative collection icons with the base path', () => {
      const result = withCollectionIconBasePath(
        [
          createCollection('tool-1', '/icons/tool.svg'),
          createCollection('tool-2', '/console/icons/prefixed.svg'),
        ],
        '/console',
      )

      expect(result[0]!.icon).toBe('/console/icons/tool.svg')
      expect(result[1]!.icon).toBe('/console/icons/prefixed.svg')
    })
  })

  describe('buildConfigurationFeaturesData', () => {
    it('should derive feature toggles and upload fallbacks from model config', () => {
      const result = buildConfigurationFeaturesData(
        createModelConfig({
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
        }),
        undefined,
      )

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
    it('should block publish when advanced completion mode is missing required blocks', () => {
      const result = getConfigurationPublishingState({
        chatPromptConfig: {
          prompt: [],
        },
        completionPromptConfig: {
          prompt: { text: 'Answer' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        },
        hasSetBlockStatus: {
          context: false,
          history: false,
          query: false,
        },
        hasSetContextVar: false,
        hasSelectedDataSets: false,
        isAdvancedMode: true,
        mode: 'chat' as const,
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
        },
        completionPromptConfig: {
          prompt: { text: 'Completion prompt' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        },
        hasSetBlockStatus: {
          context: false,
          history: true,
          query: true,
        },
        hasSetContextVar: false,
        hasSelectedDataSets: true,
        isAdvancedMode: false,
        mode: 'completion' as const,
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
        },
        completionPromptConfig: {
          prompt: { text: 'ignored' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        },
        hasSetBlockStatus: {
          context: true,
          history: true,
          query: true,
        },
        hasSetContextVar: true,
        hasSelectedDataSets: false,
        isAdvancedMode: true,
        mode: 'completion' as const,
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
        },
        completionPromptConfig: {
          prompt: { text: '' },
          conversation_histories_role: {
            user_prefix: 'user',
            assistant_prefix: 'assistant',
          },
        },
        hasSetBlockStatus: {
          context: true,
          history: true,
          query: true,
        },
        hasSetContextVar: true,
        hasSelectedDataSets: false,
        isAdvancedMode: true,
        mode: 'completion' as const,
        modelModeType: ModelModeType.completion,
        promptTemplate: 'ignored',
      })

      expect(result.promptEmpty).toBe(true)
      expect(result.cannotPublish).toBe(true)
    })
  })
})
