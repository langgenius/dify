import type { TriggerEventParameter } from '../../../plugins/types'
import type { ToolCredential, ToolParameter } from '../../types'
import { describe, expect, it } from 'vitest'
import {
  addDefaultValue,
  generateAgentToolValue,
  generateFormValue,
  getConfiguredValue,
  getPlainValue,
  getStructureValue,
  toolCredentialToFormSchemas,
  toolParametersToFormSchemas,
  toType,
  triggerEventParametersToFormSchemas,
} from '../to-form-schema'

describe('to-form-schema utilities', () => {
  describe('toType', () => {
    it('converts "string" to "text-input"', () => {
      expect(toType('string')).toBe('text-input')
    })

    it('converts "number" to "number-input"', () => {
      expect(toType('number')).toBe('number-input')
    })

    it('converts "boolean" to "checkbox"', () => {
      expect(toType('boolean')).toBe('checkbox')
    })

    it('returns the original type for unknown types', () => {
      expect(toType('select')).toBe('select')
      expect(toType('secret-input')).toBe('secret-input')
      expect(toType('file')).toBe('file')
    })
  })

  describe('triggerEventParametersToFormSchemas', () => {
    it('returns empty array for null/undefined parameters', () => {
      expect(triggerEventParametersToFormSchemas(null as unknown as TriggerEventParameter[])).toEqual([])
      expect(triggerEventParametersToFormSchemas([])).toEqual([])
    })

    it('maps parameters with type conversion and tooltip from description', () => {
      const params = [
        {
          name: 'query',
          type: 'string',
          description: { en_US: 'Search query', zh_Hans: '搜索查询' },
          label: { en_US: 'Query', zh_Hans: '查询' },
          required: true,
          form: 'llm',
        },
      ] as unknown as TriggerEventParameter[]
      const result = triggerEventParametersToFormSchemas(params)
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('text-input')
      expect(result[0]._type).toBe('string')
      expect(result[0].tooltip).toEqual({ en_US: 'Search query', zh_Hans: '搜索查询' })
    })

    it('preserves all original fields via spread', () => {
      const params = [
        {
          name: 'count',
          type: 'number',
          description: { en_US: 'Count', zh_Hans: '数量' },
          label: { en_US: 'Count', zh_Hans: '数量' },
          required: false,
          form: 'form',
        },
      ] as unknown as TriggerEventParameter[]
      const result = triggerEventParametersToFormSchemas(params)
      expect(result[0].name).toBe('count')
      expect(result[0].label).toEqual({ en_US: 'Count', zh_Hans: '数量' })
      expect(result[0].required).toBe(false)
    })
  })

  describe('toolParametersToFormSchemas', () => {
    it('returns empty array for null parameters', () => {
      expect(toolParametersToFormSchemas(null as unknown as ToolParameter[])).toEqual([])
    })

    it('converts parameters with variable = name and type conversion', () => {
      const params: ToolParameter[] = [
        {
          name: 'input_text',
          label: { en_US: 'Input', zh_Hans: '输入' },
          human_description: { en_US: 'Enter text', zh_Hans: '输入文本' },
          type: 'string',
          form: 'llm',
          llm_description: 'The input text',
          required: true,
          multiple: false,
          default: 'hello',
        },
      ]
      const result = toolParametersToFormSchemas(params)
      expect(result).toHaveLength(1)
      expect(result[0].variable).toBe('input_text')
      expect(result[0].type).toBe('text-input')
      expect(result[0]._type).toBe('string')
      expect(result[0].show_on).toEqual([])
      expect(result[0].tooltip).toEqual({ en_US: 'Enter text', zh_Hans: '输入文本' })
    })

    it('maps options with show_on = []', () => {
      const params: ToolParameter[] = [
        {
          name: 'mode',
          label: { en_US: 'Mode', zh_Hans: '模式' },
          human_description: { en_US: 'Select mode', zh_Hans: '选择模式' },
          type: 'select',
          form: 'form',
          llm_description: '',
          required: false,
          multiple: false,
          default: 'fast',
          options: [
            { label: { en_US: 'Fast', zh_Hans: '快速' }, value: 'fast' },
            { label: { en_US: 'Accurate', zh_Hans: '精确' }, value: 'accurate' },
          ],
        },
      ]
      const result = toolParametersToFormSchemas(params)
      expect(result[0].options).toHaveLength(2)
      expect(result[0].options![0].show_on).toEqual([])
      expect(result[0].options![1].show_on).toEqual([])
    })

    it('handles parameters without options', () => {
      const params: ToolParameter[] = [
        {
          name: 'flag',
          label: { en_US: 'Flag', zh_Hans: '标记' },
          human_description: { en_US: 'Enable', zh_Hans: '启用' },
          type: 'boolean',
          form: 'form',
          llm_description: '',
          required: false,
          multiple: false,
          default: 'false',
        },
      ]
      const result = toolParametersToFormSchemas(params)
      expect(result[0].options).toBeUndefined()
    })
  })

  describe('toolCredentialToFormSchemas', () => {
    it('returns empty array for null parameters', () => {
      expect(toolCredentialToFormSchemas(null as unknown as ToolCredential[])).toEqual([])
    })

    it('converts credentials with variable = name and tooltip from help', () => {
      const creds: ToolCredential[] = [
        {
          name: 'api_key',
          label: { en_US: 'API Key', zh_Hans: 'API 密钥' },
          help: { en_US: 'Enter your API key', zh_Hans: '输入你的 API 密钥' },
          placeholder: { en_US: 'sk-xxx', zh_Hans: 'sk-xxx' },
          type: 'secret-input',
          required: true,
          default: '',
        },
      ]
      const result = toolCredentialToFormSchemas(creds)
      expect(result).toHaveLength(1)
      expect(result[0].variable).toBe('api_key')
      expect(result[0].type).toBe('secret-input')
      expect(result[0].tooltip).toEqual({ en_US: 'Enter your API key', zh_Hans: '输入你的 API 密钥' })
      expect(result[0].show_on).toEqual([])
    })

    it('handles null help field → tooltip becomes undefined', () => {
      const creds: ToolCredential[] = [
        {
          name: 'token',
          label: { en_US: 'Token', zh_Hans: '令牌' },
          help: null,
          placeholder: { en_US: '', zh_Hans: '' },
          type: 'string',
          required: false,
          default: '',
        },
      ]
      const result = toolCredentialToFormSchemas(creds)
      expect(result[0].tooltip).toBeUndefined()
    })

    it('maps credential options with show_on = []', () => {
      const creds: ToolCredential[] = [
        {
          name: 'auth_method',
          label: { en_US: 'Auth', zh_Hans: '认证' },
          help: null,
          placeholder: { en_US: '', zh_Hans: '' },
          type: 'select',
          required: true,
          default: 'bearer',
          options: [
            { label: { en_US: 'Bearer', zh_Hans: 'Bearer' }, value: 'bearer' },
            { label: { en_US: 'Basic', zh_Hans: 'Basic' }, value: 'basic' },
          ],
        },
      ]
      const result = toolCredentialToFormSchemas(creds)
      expect(result[0].options).toHaveLength(2)
      result[0].options!.forEach(opt => expect(opt.show_on).toEqual([]))
    })
  })

  describe('addDefaultValue', () => {
    it('fills in default when value is empty/null/undefined', () => {
      const schemas = [
        { variable: 'name', type: 'text-input', default: 'default-name' },
        { variable: 'count', type: 'number-input', default: 10 },
      ]
      const result = addDefaultValue({}, schemas)
      expect(result.name).toBe('default-name')
      expect(result.count).toBe(10)
    })

    it('does not override existing values', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'default' }]
      const result = addDefaultValue({ name: 'existing' }, schemas)
      expect(result.name).toBe('existing')
    })

    it('fills default for empty string value', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'default' }]
      const result = addDefaultValue({ name: '' }, schemas)
      expect(result.name).toBe('default')
    })

    it('converts string boolean values to proper boolean type', () => {
      const schemas = [{ variable: 'flag', type: 'boolean' }]
      expect(addDefaultValue({ flag: 'true' }, schemas).flag).toBe(true)
      expect(addDefaultValue({ flag: 'false' }, schemas).flag).toBe(false)
      expect(addDefaultValue({ flag: '1' }, schemas).flag).toBe(true)
      expect(addDefaultValue({ flag: 'True' }, schemas).flag).toBe(true)
      expect(addDefaultValue({ flag: '0' }, schemas).flag).toBe(false)
    })

    it('converts number boolean values to proper boolean type', () => {
      const schemas = [{ variable: 'flag', type: 'boolean' }]
      expect(addDefaultValue({ flag: 1 }, schemas).flag).toBe(true)
      expect(addDefaultValue({ flag: 0 }, schemas).flag).toBe(false)
    })

    it('preserves actual boolean values', () => {
      const schemas = [{ variable: 'flag', type: 'boolean' }]
      expect(addDefaultValue({ flag: true }, schemas).flag).toBe(true)
      expect(addDefaultValue({ flag: false }, schemas).flag).toBe(false)
    })
  })

  describe('generateFormValue', () => {
    it('generates constant-type value wrapper for defaults', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'hello' }]
      const result = generateFormValue({}, schemas)
      expect(result.name).toBeDefined()
      const wrapper = result.name as { value: { type: string, value: unknown } }
      // correctInitialData sets type to 'mixed' for text-input but preserves default value
      expect(wrapper.value.type).toBe('mixed')
      expect(wrapper.value.value).toBe('hello')
    })

    it('skips values that already exist', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'hello' }]
      const result = generateFormValue({ name: 'existing' }, schemas)
      expect(result.name).toBeUndefined()
    })

    it('generates auto:1 for reasoning mode', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'hello' }]
      const result = generateFormValue({}, schemas, true)
      expect(result.name).toEqual({ auto: 1, value: null })
    })

    it('handles boolean default conversion in non-reasoning mode', () => {
      const schemas = [{ variable: 'flag', type: 'boolean', default: 'true' }]
      const result = generateFormValue({}, schemas)
      const wrapper = result.flag as { value: { type: string, value: unknown } }
      expect(wrapper.value.value).toBe(true)
    })

    it('handles number-input default conversion', () => {
      const schemas = [{ variable: 'count', type: 'number-input', default: '42' }]
      const result = generateFormValue({}, schemas)
      const wrapper = result.count as { value: { type: string, value: unknown } }
      expect(wrapper.value.value).toBe(42)
    })
  })

  describe('getPlainValue', () => {
    it('unwraps { value: ... } structure to plain values', () => {
      const input = {
        a: { value: { type: 'constant', val: 1 } },
        b: { value: { type: 'mixed', val: 'text' } },
      }
      const result = getPlainValue(input)
      expect(result.a).toEqual({ type: 'constant', val: 1 })
      expect(result.b).toEqual({ type: 'mixed', val: 'text' })
    })

    it('returns empty object for empty input', () => {
      expect(getPlainValue({})).toEqual({})
    })
  })

  describe('getStructureValue', () => {
    it('wraps plain values into { value: ... } structure', () => {
      const input = { a: 'hello', b: 42 }
      const result = getStructureValue(input)
      expect(result).toEqual({ a: { value: 'hello' }, b: { value: 42 } })
    })

    it('returns empty object for empty input', () => {
      expect(getStructureValue({})).toEqual({})
    })
  })

  describe('getConfiguredValue', () => {
    it('fills defaults with correctInitialData for missing values', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'hello' }]
      const result = getConfiguredValue({}, schemas)
      const val = result.name as { type: string, value: unknown }
      expect(val.type).toBe('mixed')
    })

    it('does not override existing values', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'hello' }]
      const result = getConfiguredValue({ name: 'existing' }, schemas)
      expect(result.name).toBe('existing')
    })

    it('escapes newlines in string defaults', () => {
      const schemas = [{ variable: 'prompt', type: 'text-input', default: 'line1\nline2' }]
      const result = getConfiguredValue({}, schemas)
      const val = result.prompt as { type: string, value: unknown }
      expect(val.type).toBe('mixed')
      expect(val.value).toBe('line1\\nline2')
    })

    it('handles boolean default conversion', () => {
      const schemas = [{ variable: 'flag', type: 'boolean', default: 'true' }]
      const result = getConfiguredValue({}, schemas)
      const val = result.flag as { type: string, value: unknown }
      expect(val.value).toBe(true)
    })

    it('handles app-selector type', () => {
      const schemas = [{ variable: 'app', type: 'app-selector', default: 'app-id-123' }]
      const result = getConfiguredValue({}, schemas)
      const val = result.app as { type: string, value: unknown }
      expect(val.value).toBe('app-id-123')
    })
  })

  describe('generateAgentToolValue', () => {
    it('generates constant-type values in non-reasoning mode', () => {
      const schemas = [{ variable: 'name', type: 'text-input', default: 'hello' }]
      const value = { name: { value: 'world' } }
      const result = generateAgentToolValue(value, schemas)
      expect(result.name.value).toBeDefined()
      expect(result.name.value!.type).toBe('mixed')
    })

    it('generates auto:1 for auto-mode parameters in reasoning mode', () => {
      const schemas = [{ variable: 'name', type: 'text-input' }]
      const value = { name: { auto: 1 as const, value: undefined } }
      const result = generateAgentToolValue(value, schemas, true)
      expect(result.name).toEqual({ auto: 1, value: null })
    })

    it('generates auto:0 with value for manual parameters in reasoning mode', () => {
      const schemas = [{ variable: 'name', type: 'text-input' }]
      const value = { name: { auto: 0 as const, value: { type: 'constant', value: 'manual' } } }
      const result = generateAgentToolValue(value, schemas, true)
      expect(result.name.auto).toBe(0)
      expect(result.name.value).toEqual({ type: 'constant', value: 'manual' })
    })

    it('handles undefined value in reasoning mode with fallback', () => {
      const schemas = [{ variable: 'name', type: 'select' }]
      const value = { name: { auto: 0 as const, value: undefined } }
      const result = generateAgentToolValue(value, schemas, true)
      expect(result.name.auto).toBe(0)
      expect(result.name.value).toEqual({ type: 'constant', value: null })
    })

    it('applies correctInitialData for text-input type', () => {
      const schemas = [{ variable: 'query', type: 'text-input' }]
      const value = { query: { value: 'search term' } }
      const result = generateAgentToolValue(value, schemas)
      expect(result.query.value!.type).toBe('mixed')
    })

    it('applies correctInitialData for boolean type conversion', () => {
      const schemas = [{ variable: 'flag', type: 'boolean' }]
      const value = { flag: { value: 'true' } }
      const result = generateAgentToolValue(value, schemas)
      expect(result.flag.value!.value).toBe(true)
    })
  })
})
