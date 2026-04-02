/**
 * Integration Test: Tool Data Processing Pipeline
 *
 * Tests the integration between tool utility functions and type conversions.
 * Verifies that data flows correctly through the processing pipeline:
 * raw API data → form schemas → form values → configured values.
 */
import { describe, expect, it } from 'vitest'

import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils/index'
import {
  addDefaultValue,
  generateFormValue,
  getConfiguredValue,
  getPlainValue,
  getStructureValue,
  toolCredentialToFormSchemas,
  toolParametersToFormSchemas,
  toType,
  triggerEventParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'

describe('Tool Data Processing Pipeline Integration', () => {
  describe('End-to-end: API schema → form schema → form value', () => {
    it('processes tool parameters through the full pipeline', () => {
      const rawParameters = [
        {
          name: 'query',
          label: { en_US: 'Search Query', zh_Hans: '搜索查询' },
          type: 'string',
          required: true,
          default: 'hello',
          form: 'llm',
          human_description: { en_US: 'Enter your search query', zh_Hans: '输入搜索查询' },
          llm_description: 'The search query string',
          options: [],
        },
        {
          name: 'limit',
          label: { en_US: 'Result Limit', zh_Hans: '结果限制' },
          type: 'number',
          required: false,
          default: '10',
          form: 'form',
          human_description: { en_US: 'Maximum results', zh_Hans: '最大结果数' },
          llm_description: 'Limit for results',
          options: [],
        },
      ]

      const formSchemas = toolParametersToFormSchemas(rawParameters as unknown as Parameters<typeof toolParametersToFormSchemas>[0])
      expect(formSchemas).toHaveLength(2)
      expect(formSchemas[0].variable).toBe('query')
      expect(formSchemas[0].required).toBe(true)
      expect(formSchemas[0].type).toBe('text-input')
      expect(formSchemas[1].variable).toBe('limit')
      expect(formSchemas[1].type).toBe('number-input')

      const withDefaults = addDefaultValue({}, formSchemas)
      expect(withDefaults.query).toBe('hello')
      expect(withDefaults.limit).toBe('10')

      const formValues = generateFormValue({}, formSchemas, false)
      expect(formValues).toBeDefined()
      expect(formValues.query).toBeDefined()
      expect(formValues.limit).toBeDefined()
    })

    it('processes tool credentials through the pipeline', () => {
      const rawCredentials = [
        {
          name: 'api_key',
          label: { en_US: 'API Key', zh_Hans: 'API 密钥' },
          type: 'secret-input',
          required: true,
          default: '',
          placeholder: { en_US: 'Enter API key', zh_Hans: '输入 API 密钥' },
          help: { en_US: 'Your API key', zh_Hans: '你的 API 密钥' },
          url: 'https://example.com/get-key',
          options: [],
        },
      ]

      const credentialSchemas = toolCredentialToFormSchemas(rawCredentials as Parameters<typeof toolCredentialToFormSchemas>[0])
      expect(credentialSchemas).toHaveLength(1)
      expect(credentialSchemas[0].variable).toBe('api_key')
      expect(credentialSchemas[0].required).toBe(true)
      expect(credentialSchemas[0].type).toBe('secret-input')
    })

    it('processes trigger event parameters through the pipeline', () => {
      const rawParams = [
        {
          name: 'event_type',
          label: { en_US: 'Event Type', zh_Hans: '事件类型' },
          type: 'select',
          required: true,
          default: 'push',
          form: 'form',
          description: { en_US: 'Type of event', zh_Hans: '事件类型' },
          options: [
            { value: 'push', label: { en_US: 'Push', zh_Hans: '推送' } },
            { value: 'pull', label: { en_US: 'Pull', zh_Hans: '拉取' } },
          ],
        },
      ]

      const schemas = triggerEventParametersToFormSchemas(rawParams as unknown as Parameters<typeof triggerEventParametersToFormSchemas>[0])
      expect(schemas).toHaveLength(1)
      expect(schemas[0].name).toBe('event_type')
      expect(schemas[0].type).toBe('select')
      expect(schemas[0].options).toHaveLength(2)
    })
  })

  describe('Type conversion integration', () => {
    it('converts all supported types correctly', () => {
      const typeConversions = [
        { input: 'string', expected: 'text-input' },
        { input: 'number', expected: 'number-input' },
        { input: 'boolean', expected: 'checkbox' },
        { input: 'select', expected: 'select' },
        { input: 'secret-input', expected: 'secret-input' },
        { input: 'file', expected: 'file' },
        { input: 'files', expected: 'files' },
      ]

      typeConversions.forEach(({ input, expected }) => {
        expect(toType(input)).toBe(expected)
      })
    })

    it('returns the original type for unrecognized types', () => {
      expect(toType('unknown-type')).toBe('unknown-type')
      expect(toType('app-selector')).toBe('app-selector')
    })
  })

  describe('Value extraction integration', () => {
    it('wraps values with getStructureValue and extracts inner value with getPlainValue', () => {
      const plainInput = { query: 'test', limit: 10 }
      const structured = getStructureValue(plainInput)

      expect(structured.query).toEqual({ value: 'test' })
      expect(structured.limit).toEqual({ value: 10 })

      const objectStructured = {
        query: { value: { type: 'constant', content: 'test search' } },
        limit: { value: { type: 'constant', content: 10 } },
      }
      const extracted = getPlainValue(objectStructured)
      expect(extracted.query).toEqual({ type: 'constant', content: 'test search' })
      expect(extracted.limit).toEqual({ type: 'constant', content: 10 })
    })

    it('handles getConfiguredValue for workflow tool configurations', () => {
      const formSchemas = [
        { variable: 'query', type: 'text-input', default: 'default-query' },
        { variable: 'format', type: 'select', default: 'json' },
      ]

      const configured = getConfiguredValue({}, formSchemas)
      expect(configured).toBeDefined()
      expect(configured.query).toBeDefined()
      expect(configured.format).toBeDefined()
    })

    it('preserves existing values in getConfiguredValue', () => {
      const formSchemas = [
        { variable: 'query', type: 'text-input', default: 'default-query' },
      ]

      const configured = getConfiguredValue({ query: 'my-existing-query' }, formSchemas)
      expect(configured.query).toBe('my-existing-query')
    })
  })

  describe('Agent utilities integration', () => {
    it('sorts agent thoughts and enriches with file infos end-to-end', () => {
      const thoughts = [
        { id: 't3', position: 3, tool: 'search', files: ['f1'] },
        { id: 't1', position: 1, tool: 'analyze', files: [] },
        { id: 't2', position: 2, tool: 'summarize', files: ['f2'] },
      ] as Parameters<typeof sortAgentSorts>[0]

      const messageFiles = [
        { id: 'f1', name: 'result.txt', type: 'document' },
        { id: 'f2', name: 'summary.pdf', type: 'document' },
      ] as Parameters<typeof addFileInfos>[1]

      const sorted = sortAgentSorts(thoughts)
      expect(sorted[0].id).toBe('t1')
      expect(sorted[1].id).toBe('t2')
      expect(sorted[2].id).toBe('t3')

      const enriched = addFileInfos(sorted, messageFiles)
      expect(enriched[0].message_files).toBeUndefined()
      expect(enriched[1].message_files).toHaveLength(1)
      expect(enriched[1].message_files![0].id).toBe('f2')
      expect(enriched[2].message_files).toHaveLength(1)
      expect(enriched[2].message_files![0].id).toBe('f1')
    })

    it('handles null inputs gracefully in the pipeline', () => {
      const sortedNull = sortAgentSorts(null as never)
      expect(sortedNull).toBeNull()

      const enrichedNull = addFileInfos(null as never, [])
      expect(enrichedNull).toBeNull()

      // addFileInfos with empty list and null files returns the mapped (empty) list
      const enrichedEmptyList = addFileInfos([], null as never)
      expect(enrichedEmptyList).toEqual([])
    })
  })

  describe('Default value application', () => {
    it('applies defaults only to empty fields, preserving user values', () => {
      const userValues = { api_key: 'user-provided-key' }
      const schemas = [
        { variable: 'api_key', type: 'text-input', default: 'default-key', name: 'api_key' },
        { variable: 'secret', type: 'secret-input', default: 'default-secret', name: 'secret' },
      ]

      const result = addDefaultValue(userValues, schemas)
      expect(result.api_key).toBe('user-provided-key')
      expect(result.secret).toBe('default-secret')
    })

    it('handles boolean type conversion in defaults', () => {
      const schemas = [
        { variable: 'enabled', type: 'boolean', default: 'true', name: 'enabled' },
      ]

      const result = addDefaultValue({ enabled: 'true' }, schemas)
      expect(result.enabled).toBe(true)
    })
  })
})
