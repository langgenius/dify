import { describe, expect, it } from 'vite-plus/test'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { FormTypeEnum, ModelTypeEnum } from '../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
  modelProviderDetailsQueryOptions,
  modelTypeFormat,
  sizeFormat,
} from '../utils'

describe('utils', () => {
  describe('sizeFormat', () => {
    it('should format size less than 1000', () => {
      expect(sizeFormat(500)).toBe('500')
    })

    it('should format size greater than 1000', () => {
      expect(sizeFormat(1500)).toBe('1K')
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

  describe('modelProviderDetailsQueryOptions', () => {
    it('should map credential schemas and nullable provider fields to the UI provider', () => {
      const select = modelProviderDetailsQueryOptions().select!
      const { data } = select({
        data: [
          createProviderResponseFixture({
            help: null,
            background: null,
            provider_credential_schema: {
              credential_form_schemas: [
                {
                  variable: 'api_key',
                  type: 'secret-input',
                  label: { en_US: 'API Key', zh_Hans: null },
                  max_length: 0,
                  required: false,
                  show_on: [],
                  options: [{ label: { en_US: 'One' }, value: '1', show_on: [] }],
                },
              ],
            },
            system_configuration: {
              enabled: true,
              current_quota_type: null,
              quota_configurations: [],
            },
          }),
        ],
      })

      expect(data[0]).toMatchObject({
        label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
        help: undefined,
        background: undefined,
        supported_model_types: [ModelTypeEnum.textGeneration],
        system_configuration: { enabled: true, quota_configurations: [] },
        provider_credential_schema: {
          credential_form_schemas: [
            {
              name: 'api_key',
              variable: 'api_key',
              type: FormTypeEnum.secretInput,
              label: { en_US: 'API Key', zh_Hans: 'API Key' },
              required: false,
              show_on: [],
              options: [{ label: { en_US: 'One', zh_Hans: 'One' }, value: '1', show_on: [] }],
            },
          ],
        },
      })
      expect(data[0]!.system_configuration.current_quota_type).toBeUndefined()
    })
  })
})
