/**
 * Integration test: Input field CRUD complete flow
 *
 * Validates the full lifecycle of input fields:
 * creation, editing, renaming, removal, and data conversion round-trip.
 */
import type { FormData } from '@/app/components/rag-pipeline/components/panel/input-field/editor/form/types'
import type { InputVar } from '@/models/pipeline'
import { describe, expect, it, vi } from 'vitest'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'

vi.mock('@/config', () => ({
  VAR_ITEM_TEMPLATE_IN_PIPELINE: {
    type: 'text-input',
    label: '',
    variable: '',
    max_length: 48,
    default_value: undefined,
    required: true,
    tooltips: undefined,
    options: [],
    placeholder: undefined,
    unit: undefined,
    allowed_file_upload_methods: undefined,
    allowed_file_types: undefined,
    allowed_file_extensions: undefined,
  },
}))

describe('Input Field CRUD Flow', () => {
  describe('Create → Edit → Convert Round-trip', () => {
    it('should create a text field and roundtrip through form data', async () => {
      const { convertToInputFieldFormData, convertFormDataToINputField } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      // Create new field from template (no data passed)
      const newFormData = convertToInputFieldFormData()
      expect(newFormData.type).toBe('text-input')
      expect(newFormData.variable).toBe('')
      expect(newFormData.label).toBe('')
      expect(newFormData.required).toBe(true)

      // Simulate user editing form data
      const editedFormData: FormData = {
        ...newFormData,
        variable: 'user_name',
        label: 'User Name',
        maxLength: 100,
        default: 'John',
        tooltips: 'Enter your name',
        placeholder: 'Type here...',
        allowedTypesAndExtensions: {},
      }

      // Convert back to InputVar
      const inputVar = convertFormDataToINputField(editedFormData)

      expect(inputVar.variable).toBe('user_name')
      expect(inputVar.label).toBe('User Name')
      expect(inputVar.max_length).toBe(100)
      expect(inputVar.default_value).toBe('John')
      expect(inputVar.tooltips).toBe('Enter your name')
      expect(inputVar.placeholder).toBe('Type here...')
      expect(inputVar.required).toBe(true)
    })

    it('should handle file field with upload settings', async () => {
      const { convertToInputFieldFormData, convertFormDataToINputField } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      const fileInputVar: InputVar = {
        type: PipelineInputVarType.singleFile,
        label: 'Upload Document',
        variable: 'doc_file',
        max_length: 1,
        default_value: undefined,
        required: true,
        tooltips: 'Upload a PDF',
        options: [],
        placeholder: undefined,
        unit: undefined,
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        allowed_file_types: [SupportUploadFileTypes.document],
        allowed_file_extensions: ['.pdf', '.docx'],
      }

      // Convert to form data
      const formData = convertToInputFieldFormData(fileInputVar)
      expect(formData.allowedFileUploadMethods).toEqual([TransferMethod.local_file, TransferMethod.remote_url])
      expect(formData.allowedTypesAndExtensions).toEqual({
        allowedFileTypes: [SupportUploadFileTypes.document],
        allowedFileExtensions: ['.pdf', '.docx'],
      })

      // Round-trip back
      const restored = convertFormDataToINputField(formData)
      expect(restored.allowed_file_upload_methods).toEqual([TransferMethod.local_file, TransferMethod.remote_url])
      expect(restored.allowed_file_types).toEqual([SupportUploadFileTypes.document])
      expect(restored.allowed_file_extensions).toEqual(['.pdf', '.docx'])
    })

    it('should handle select field with options', async () => {
      const { convertToInputFieldFormData, convertFormDataToINputField } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      const selectVar: InputVar = {
        type: PipelineInputVarType.select,
        label: 'Priority',
        variable: 'priority',
        max_length: 0,
        default_value: 'medium',
        required: false,
        tooltips: 'Select priority level',
        options: ['low', 'medium', 'high'],
        placeholder: 'Choose...',
        unit: undefined,
        allowed_file_upload_methods: undefined,
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      }

      const formData = convertToInputFieldFormData(selectVar)
      expect(formData.options).toEqual(['low', 'medium', 'high'])
      expect(formData.default).toBe('medium')

      const restored = convertFormDataToINputField(formData)
      expect(restored.options).toEqual(['low', 'medium', 'high'])
      expect(restored.default_value).toBe('medium')
    })

    it('should handle number field with unit', async () => {
      const { convertToInputFieldFormData, convertFormDataToINputField } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      const numberVar: InputVar = {
        type: PipelineInputVarType.number,
        label: 'Max Tokens',
        variable: 'max_tokens',
        max_length: 0,
        default_value: '1024',
        required: true,
        tooltips: undefined,
        options: [],
        placeholder: undefined,
        unit: 'tokens',
        allowed_file_upload_methods: undefined,
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      }

      const formData = convertToInputFieldFormData(numberVar)
      expect(formData.unit).toBe('tokens')
      expect(formData.default).toBe('1024')

      const restored = convertFormDataToINputField(formData)
      expect(restored.unit).toBe('tokens')
      expect(restored.default_value).toBe('1024')
    })
  })

  describe('Omit optional fields', () => {
    it('should not include tooltips when undefined', async () => {
      const { convertToInputFieldFormData } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      const inputVar: InputVar = {
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test',
        max_length: 48,
        default_value: undefined,
        required: true,
        tooltips: undefined,
        options: [],
        placeholder: undefined,
        unit: undefined,
        allowed_file_upload_methods: undefined,
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      }

      const formData = convertToInputFieldFormData(inputVar)

      // Optional fields should not be present
      expect('tooltips' in formData).toBe(false)
      expect('placeholder' in formData).toBe(false)
      expect('unit' in formData).toBe(false)
      expect('default' in formData).toBe(false)
    })

    it('should include optional fields when explicitly set to empty string', async () => {
      const { convertToInputFieldFormData } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      const inputVar: InputVar = {
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test',
        max_length: 48,
        default_value: '',
        required: true,
        tooltips: '',
        options: [],
        placeholder: '',
        unit: '',
        allowed_file_upload_methods: undefined,
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      }

      const formData = convertToInputFieldFormData(inputVar)

      expect(formData.default).toBe('')
      expect(formData.tooltips).toBe('')
      expect(formData.placeholder).toBe('')
      expect(formData.unit).toBe('')
    })
  })

  describe('Multiple fields workflow', () => {
    it('should process multiple fields independently', async () => {
      const { convertToInputFieldFormData, convertFormDataToINputField } = await import(
        '@/app/components/rag-pipeline/components/panel/input-field/editor/utils',
      )

      const fields: InputVar[] = [
        {
          type: PipelineInputVarType.textInput,
          label: 'Name',
          variable: 'name',
          max_length: 48,
          default_value: 'Alice',
          required: true,
          tooltips: undefined,
          options: [],
          placeholder: undefined,
          unit: undefined,
          allowed_file_upload_methods: undefined,
          allowed_file_types: undefined,
          allowed_file_extensions: undefined,
        },
        {
          type: PipelineInputVarType.number,
          label: 'Count',
          variable: 'count',
          max_length: 0,
          default_value: '10',
          required: false,
          tooltips: undefined,
          options: [],
          placeholder: undefined,
          unit: 'items',
          allowed_file_upload_methods: undefined,
          allowed_file_types: undefined,
          allowed_file_extensions: undefined,
        },
      ]

      const formDataList = fields.map(f => convertToInputFieldFormData(f))
      const restoredFields = formDataList.map(fd => convertFormDataToINputField(fd))

      expect(restoredFields).toHaveLength(2)
      expect(restoredFields[0].variable).toBe('name')
      expect(restoredFields[0].default_value).toBe('Alice')
      expect(restoredFields[1].variable).toBe('count')
      expect(restoredFields[1].default_value).toBe('10')
      expect(restoredFields[1].unit).toBe('items')
    })
  })
})
