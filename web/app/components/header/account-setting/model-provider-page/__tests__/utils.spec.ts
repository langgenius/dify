import { describe, expect, it, vi } from 'vitest'
import { FormTypeEnum, ModelTypeEnum } from '../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
  modelTypeFormat,
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
})
