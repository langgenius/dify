import { describe, expect, it } from 'vitest'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { NAME_FIELD } from './utils'

describe('utils', () => {
  describe('NAME_FIELD', () => {
    it('should have correct type', () => {
      expect(NAME_FIELD.type).toBe(FormTypeEnum.textInput)
    })

    it('should have correct name', () => {
      expect(NAME_FIELD.name).toBe('name')
    })

    it('should have label translations', () => {
      expect(NAME_FIELD.label).toBeDefined()
      expect(NAME_FIELD.label.en_US).toBe('Endpoint Name')
      expect(NAME_FIELD.label.zh_Hans).toBe('端点名称')
      expect(NAME_FIELD.label.ja_JP).toBe('エンドポイント名')
      expect(NAME_FIELD.label.pt_BR).toBe('Nome do ponto final')
    })

    it('should have placeholder translations', () => {
      expect(NAME_FIELD.placeholder).toBeDefined()
      expect(NAME_FIELD.placeholder.en_US).toBe('Endpoint Name')
      expect(NAME_FIELD.placeholder.zh_Hans).toBe('端点名称')
      expect(NAME_FIELD.placeholder.ja_JP).toBe('エンドポイント名')
      expect(NAME_FIELD.placeholder.pt_BR).toBe('Nome do ponto final')
    })

    it('should be required', () => {
      expect(NAME_FIELD.required).toBe(true)
    })

    it('should have empty default value', () => {
      expect(NAME_FIELD.default).toBe('')
    })

    it('should have null help', () => {
      expect(NAME_FIELD.help).toBeNull()
    })

    it('should have all required field properties', () => {
      const requiredKeys = ['type', 'name', 'label', 'placeholder', 'required', 'default', 'help']
      requiredKeys.forEach((key) => {
        expect(NAME_FIELD).toHaveProperty(key)
      })
    })

    it('should match expected structure', () => {
      expect(NAME_FIELD).toEqual({
        type: FormTypeEnum.textInput,
        name: 'name',
        label: {
          en_US: 'Endpoint Name',
          zh_Hans: '端点名称',
          ja_JP: 'エンドポイント名',
          pt_BR: 'Nome do ponto final',
        },
        placeholder: {
          en_US: 'Endpoint Name',
          zh_Hans: '端点名称',
          ja_JP: 'エンドポイント名',
          pt_BR: 'Nome do ponto final',
        },
        required: true,
        default: '',
        help: null,
      })
    })
  })
})
