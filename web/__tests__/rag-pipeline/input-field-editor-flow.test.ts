/**
 * Integration test: Input field editor data conversion flow
 *
 * Tests the full pipeline: InputVar -> FormData -> InputVar roundtrip
 * and schema validation for various input types.
 */
import type { InputVar } from '@/models/pipeline'
import { describe, expect, it, vi } from 'vitest'
import { PipelineInputVarType } from '@/models/pipeline'

// Mock the config module for VAR_ITEM_TEMPLATE_IN_PIPELINE
vi.mock('@/config', () => ({
  VAR_ITEM_TEMPLATE_IN_PIPELINE: {
    type: 'text-input',
    label: '',
    variable: '',
    max_length: 48,
    required: false,
    options: [],
    allowed_file_upload_methods: [],
    allowed_file_types: [],
    allowed_file_extensions: [],
  },
  MAX_VAR_KEY_LENGTH: 30,
  RAG_PIPELINE_PREVIEW_CHUNK_NUM: 10,
}))

// Import real functions (not mocked)
const { convertToInputFieldFormData, convertFormDataToINputField } = await import(
  '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
)

describe('Input Field Editor Data Flow', () => {
  describe('convertToInputFieldFormData', () => {
    it('should convert a text input InputVar to FormData', () => {
      const inputVar: InputVar = {
        type: 'text-input',
        label: 'Name',
        variable: 'user_name',
        max_length: 100,
        required: true,
        default_value: 'John',
        tooltips: 'Enter your name',
        placeholder: 'Type here...',
        options: [],
      } as InputVar

      const formData = convertToInputFieldFormData(inputVar)

      expect(formData.type).toBe('text-input')
      expect(formData.label).toBe('Name')
      expect(formData.variable).toBe('user_name')
      expect(formData.maxLength).toBe(100)
      expect(formData.required).toBe(true)
      expect(formData.default).toBe('John')
      expect(formData.tooltips).toBe('Enter your name')
      expect(formData.placeholder).toBe('Type here...')
    })

    it('should handle file input with upload settings', () => {
      const inputVar: InputVar = {
        type: 'file',
        label: 'Document',
        variable: 'doc',
        required: false,
        allowed_file_upload_methods: ['local_file', 'remote_url'],
        allowed_file_types: ['document', 'image'],
        allowed_file_extensions: ['.pdf', '.jpg'],
        options: [],
      } as InputVar

      const formData = convertToInputFieldFormData(inputVar)

      expect(formData.allowedFileUploadMethods).toEqual(['local_file', 'remote_url'])
      expect(formData.allowedTypesAndExtensions).toEqual({
        allowedFileTypes: ['document', 'image'],
        allowedFileExtensions: ['.pdf', '.jpg'],
      })
    })

    it('should use template defaults when no data provided', () => {
      const formData = convertToInputFieldFormData(undefined)

      expect(formData.type).toBe('text-input')
      expect(formData.maxLength).toBe(48)
      expect(formData.required).toBe(false)
    })

    it('should omit undefined/null optional fields', () => {
      const inputVar: InputVar = {
        type: 'text-input',
        label: 'Simple',
        variable: 'simple_var',
        max_length: 50,
        required: false,
        options: [],
      } as InputVar

      const formData = convertToInputFieldFormData(inputVar)

      expect(formData.default).toBeUndefined()
      expect(formData.tooltips).toBeUndefined()
      expect(formData.placeholder).toBeUndefined()
      expect(formData.unit).toBeUndefined()
    })
  })

  describe('convertFormDataToINputField', () => {
    it('should convert FormData back to InputVar', () => {
      const formData = {
        type: PipelineInputVarType.textInput,
        label: 'Name',
        variable: 'user_name',
        maxLength: 100,
        required: true,
        default: 'John',
        tooltips: 'Enter your name',
        options: [],
        placeholder: 'Type here...',
        allowedTypesAndExtensions: {
          allowedFileTypes: undefined,
          allowedFileExtensions: undefined,
        },
      }

      const inputVar = convertFormDataToINputField(formData)

      expect(inputVar.type).toBe('text-input')
      expect(inputVar.label).toBe('Name')
      expect(inputVar.variable).toBe('user_name')
      expect(inputVar.max_length).toBe(100)
      expect(inputVar.required).toBe(true)
      expect(inputVar.default_value).toBe('John')
      expect(inputVar.tooltips).toBe('Enter your name')
    })
  })

  describe('roundtrip conversion', () => {
    it('should preserve text input data through roundtrip', () => {
      const original: InputVar = {
        type: 'text-input',
        label: 'Question',
        variable: 'question',
        max_length: 200,
        required: true,
        default_value: 'What is AI?',
        tooltips: 'Enter your question',
        placeholder: 'Ask something...',
        options: [],
      } as InputVar

      const formData = convertToInputFieldFormData(original)
      const restored = convertFormDataToINputField(formData)

      expect(restored.type).toBe(original.type)
      expect(restored.label).toBe(original.label)
      expect(restored.variable).toBe(original.variable)
      expect(restored.max_length).toBe(original.max_length)
      expect(restored.required).toBe(original.required)
      expect(restored.default_value).toBe(original.default_value)
      expect(restored.tooltips).toBe(original.tooltips)
      expect(restored.placeholder).toBe(original.placeholder)
    })

    it('should preserve number input data through roundtrip', () => {
      const original = {
        type: 'number',
        label: 'Temperature',
        variable: 'temp',
        required: false,
        default_value: '0.7',
        unit: '°C',
        options: [],
      } as InputVar

      const formData = convertToInputFieldFormData(original)
      const restored = convertFormDataToINputField(formData)

      expect(restored.type).toBe('number')
      expect(restored.unit).toBe('°C')
      expect(restored.default_value).toBe('0.7')
    })

    it('should preserve select options through roundtrip', () => {
      const original: InputVar = {
        type: 'select',
        label: 'Mode',
        variable: 'mode',
        required: true,
        options: ['fast', 'balanced', 'quality'],
      } as InputVar

      const formData = convertToInputFieldFormData(original)
      const restored = convertFormDataToINputField(formData)

      expect(restored.options).toEqual(['fast', 'balanced', 'quality'])
    })
  })
})
