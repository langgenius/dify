import type { ModelWithProviderEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { describe, expect, it, vi } from 'vitest'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
  modelTypeFormat,
  normalizeModelProviderModelsResponse,
  providerToPluginId,
  sizeFormat,
} from '../utils'

describe('utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sizeFormat', () => {
    it('should format size less than 1000', () => {
      expect(sizeFormat(500)).toBe('500')
    })

    it('should format size greater than 1000', () => {
      expect(sizeFormat(1500)).toBe('1K')
    })
  })

  describe('providerToPluginId', () => {
    it('should return the plugin id prefix when the provider key contains a provider segment', () => {
      expect(providerToPluginId('langgenius/openai/openai')).toBe('langgenius/openai')
    })

    it('should return an empty string when the provider key has no plugin prefix', () => {
      expect(providerToPluginId('openai')).toBe('')
    })
  })

  describe('modelTypeFormat', () => {
    it('should format text embedding type', () => {
      expect(modelTypeFormat(ModelTypeEnum.textEmbedding)).toBe('TEXT EMBEDDING')
    })

    it('should format other types', () => {
      expect(modelTypeFormat(ModelTypeEnum.textGeneration)).toBe('LLM')
    })
  })

  describe('genModelTypeFormSchema', () => {
    it('should generate form schema', () => {
      const schema = genModelTypeFormSchema([ModelTypeEnum.textGeneration])
      expect(schema.type).toBe(FormTypeEnum.select)
      expect(schema.variable).toBe('__model_type')
      expect(schema.options[0]!.value).toBe(ModelTypeEnum.textGeneration)
    })
  })

  describe('genModelNameFormSchema', () => {
    it('should generate default form schema when no model provided', () => {
      const schema = genModelNameFormSchema()
      expect(schema.type).toBe(FormTypeEnum.textInput)
      expect(schema.variable).toBe('__model_name')
      expect(schema.required).toBe(true)
      expect(schema.label.en_US).toBe('Model Name')
      expect(schema.placeholder!.en_US).toBe('Please enter model name')
    })

    it('should use provided label and placeholder when model is given', () => {
      const schema = genModelNameFormSchema({
        label: { en_US: 'Custom', zh_Hans: 'Custom' },
        placeholder: { en_US: 'Enter custom', zh_Hans: 'Enter custom' },
      })
      expect(schema.label.en_US).toBe('Custom')
      expect(schema.placeholder!.en_US).toBe('Enter custom')
    })
  })

  describe('normalizeModelProviderModelsResponse', () => {
    it('should normalize generated provider model entities for existing model UI types', () => {
      const provider: ModelWithProviderEntityResponse['provider'] = {
        label: {
          en_US: 'OpenAI',
          zh_Hans: 'OpenAI',
        },
        provider: 'openai',
        supported_model_types: ['llm'],
        tenant_id: 'tenant-1',
      }
      const response: { data: ModelWithProviderEntityResponse[] } = {
        data: [
          {
            deprecated: true,
            features: ['vision', 'tool-call', 'structured-output'],
            fetch_from: 'predefined-model',
            has_invalid_load_balancing_configs: true,
            label: {
              en_US: 'GPT 4o',
              zh_Hans: null,
            },
            load_balancing_enabled: true,
            model: 'gpt-4o',
            model_properties: {
              context_size: 128000,
              mode: 'chat',
              voices: ['alloy'],
            },
            model_type: 'llm',
            provider,
            status: 'active',
          },
          {
            fetch_from: 'customizable-model',
            label: {
              en_US: 'Embedding 3',
              zh_Hans: 'Embedding 3',
            },
            model: 'text-embedding-3-large',
            model_properties: {},
            model_type: 'text-embedding',
            provider,
            status: 'no-configure',
          },
        ],
      }

      expect(normalizeModelProviderModelsResponse(response)).toEqual([
        {
          deprecated: true,
          features: [
            ModelFeatureEnum.vision,
            ModelFeatureEnum.toolCall,
            ModelFeatureEnum.StructuredOutput,
          ],
          fetch_from: ConfigurationMethodEnum.predefinedModel,
          has_invalid_load_balancing_configs: true,
          label: {
            en_US: 'GPT 4o',
            zh_Hans: 'GPT 4o',
          },
          load_balancing_enabled: true,
          model: 'gpt-4o',
          model_properties: {
            context_size: 128000,
            mode: 'chat',
          },
          model_type: ModelTypeEnum.textGeneration,
          status: ModelStatusEnum.active,
        },
        {
          deprecated: undefined,
          features: undefined,
          fetch_from: ConfigurationMethodEnum.customizableModel,
          has_invalid_load_balancing_configs: undefined,
          label: {
            en_US: 'Embedding 3',
            zh_Hans: 'Embedding 3',
          },
          load_balancing_enabled: false,
          model: 'text-embedding-3-large',
          model_properties: {},
          model_type: ModelTypeEnum.textEmbedding,
          status: ModelStatusEnum.noConfigure,
        },
      ])
    })
  })
})
