import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { PipelineInputVarType } from '@/models/pipeline'
import { createInputFieldSchema, TEXT_MAX_LENGTH } from '../schema'

vi.mock('@/config', () => ({
  MAX_VAR_KEY_LENGTH: 30,
}))

const t: TFunction = ((key: string) => key) as unknown as TFunction

const defaultOptions = { maxFileUploadLimit: 10 }

describe('TEXT_MAX_LENGTH', () => {
  it('should be 256', () => {
    expect(TEXT_MAX_LENGTH).toBe(256)
  })
})

describe('createInputFieldSchema', () => {
  describe('common schema validation', () => {
    it('should reject empty variable name', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
      const result = schema.safeParse({
        type: 'text-input',
        variable: '',
        label: 'Test',
        required: false,
        maxLength: 48,
      })

      expect(result.success).toBe(false)
    })

    it('should reject variable starting with number', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
      const result = schema.safeParse({
        type: 'text-input',
        variable: '123abc',
        label: 'Test',
        required: false,
        maxLength: 48,
      })

      expect(result.success).toBe(false)
    })

    it('should accept valid variable name', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
      const result = schema.safeParse({
        type: 'text-input',
        variable: 'valid_var',
        label: 'Test',
        required: false,
        maxLength: 48,
      })

      expect(result.success).toBe(true)
    })

    it('should reject empty label', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
      const result = schema.safeParse({
        type: 'text-input',
        variable: 'my_var',
        label: '',
        required: false,
        maxLength: 48,
      })

      expect(result.success).toBe(false)
    })
  })

  describe('text input type', () => {
    it('should validate maxLength within range', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)

      const valid = schema.safeParse({
        type: 'text-input',
        variable: 'text_var',
        label: 'Text',
        required: false,
        maxLength: 100,
      })
      expect(valid.success).toBe(true)

      const tooLow = schema.safeParse({
        type: 'text-input',
        variable: 'text_var',
        label: 'Text',
        required: false,
        maxLength: 0,
      })
      expect(tooLow.success).toBe(false)
    })

    it('should allow optional default and tooltips', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
      const result = schema.safeParse({
        type: 'text-input',
        variable: 'text_var',
        label: 'Text',
        required: false,
        maxLength: 48,
        default: 'default value',
        tooltips: 'Some help text',
      })

      expect(result.success).toBe(true)
    })
  })

  describe('paragraph type', () => {
    it('should use same schema as text input', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.paragraph, t, defaultOptions)
      const result = schema.safeParse({
        type: 'paragraph',
        variable: 'para_var',
        label: 'Paragraph',
        required: false,
        maxLength: 100,
      })

      expect(result.success).toBe(true)
    })
  })

  describe('number type', () => {
    it('should allow optional unit and placeholder', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.number, t, defaultOptions)
      const result = schema.safeParse({
        type: 'number',
        variable: 'num_var',
        label: 'Number',
        required: false,
        default: 42,
        unit: 'kg',
        placeholder: 'Enter weight',
      })

      expect(result.success).toBe(true)
    })
  })

  describe('select type', () => {
    it('should require non-empty options array', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.select, t, defaultOptions)

      const empty = schema.safeParse({
        type: 'select',
        variable: 'sel_var',
        label: 'Select',
        required: false,
        options: [],
      })
      expect(empty.success).toBe(false)

      const valid = schema.safeParse({
        type: 'select',
        variable: 'sel_var',
        label: 'Select',
        required: false,
        options: ['opt1', 'opt2'],
      })
      expect(valid.success).toBe(true)
    })

    it('should reject duplicate options', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.select, t, defaultOptions)
      const result = schema.safeParse({
        type: 'select',
        variable: 'sel_var',
        label: 'Select',
        required: false,
        options: ['opt1', 'opt1'],
      })

      expect(result.success).toBe(false)
    })
  })

  describe('singleFile type', () => {
    it('should require file upload methods and types', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.singleFile, t, defaultOptions)
      const result = schema.safeParse({
        type: 'file',
        variable: 'file_var',
        label: 'File',
        required: false,
        allowedFileUploadMethods: ['local_file'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['document'],
        },
      })

      expect(result.success).toBe(true)
    })
  })

  describe('multiFiles type', () => {
    it('should validate maxLength against maxFileUploadLimit', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.multiFiles, t, { maxFileUploadLimit: 5 })

      const valid = schema.safeParse({
        type: 'file-list',
        variable: 'files_var',
        label: 'Files',
        required: false,
        allowedFileUploadMethods: ['local_file'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image'],
        },
        maxLength: 3,
      })
      expect(valid.success).toBe(true)

      const tooMany = schema.safeParse({
        type: 'file-list',
        variable: 'files_var',
        label: 'Files',
        required: false,
        allowedFileUploadMethods: ['local_file'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image'],
        },
        maxLength: 10,
      })
      expect(tooMany.success).toBe(false)
    })
  })

  describe('checkbox / default type', () => {
    it('should use common schema for checkbox type', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.checkbox, t, defaultOptions)
      const result = schema.safeParse({
        type: 'checkbox',
        variable: 'check_var',
        label: 'Agree',
        required: true,
      })

      expect(result.success).toBe(true)
    })

    it('should allow passthrough of extra fields', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.checkbox, t, defaultOptions)
      const result = schema.safeParse({
        type: 'checkbox',
        variable: 'check_var',
        label: 'Agree',
        required: true,
        default: true,
        extraField: 'should pass through',
      })

      expect(result.success).toBe(true)
    })
  })
})
