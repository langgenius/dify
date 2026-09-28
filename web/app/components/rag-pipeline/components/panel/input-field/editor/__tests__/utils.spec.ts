import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { VAR_ITEM_TEMPLATE_IN_PIPELINE } from '@/config'
import { PipelineInputVarType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import { convertFormDataToINputField, convertToInputFieldFormData } from '../utils'

describe('input-field editor utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should convert pipeline input vars into form data', () => {
    const result = convertToInputFieldFormData({
      type: PipelineInputVarType.multiFiles,
      label: 'Upload files',
      variable: 'documents',
      max_length: 5,
      default_value: 'initial-value',
      required: false,
      tooltips: 'Tooltip text',
      options: ['a', 'b'],
      placeholder: 'Select files',
      unit: 'MB',
      allowed_file_upload_methods: [TransferMethod.local_file],
      allowed_file_types: [SupportUploadFileTypes.document],
      allowed_file_extensions: ['pdf'],
    })

    expect(result).toEqual({
      type: PipelineInputVarType.multiFiles,
      label: 'Upload files',
      variable: 'documents',
      maxLength: 5,
      default: 'initial-value',
      required: false,
      tooltips: 'Tooltip text',
      options: ['a', 'b'],
      placeholder: 'Select files',
      unit: 'MB',
      allowedFileUploadMethods: [TransferMethod.local_file],
      allowedTypesAndExtensions: {
        allowedFileTypes: [SupportUploadFileTypes.document],
        allowedFileExtensions: ['pdf'],
      },
    })
  })

  it('should fall back to the default input variable template', () => {
    const result = convertToInputFieldFormData()

    expect(result).toEqual({
      type: VAR_ITEM_TEMPLATE_IN_PIPELINE.type,
      label: VAR_ITEM_TEMPLATE_IN_PIPELINE.label,
      variable: VAR_ITEM_TEMPLATE_IN_PIPELINE.variable,
      maxLength: undefined,
      required: VAR_ITEM_TEMPLATE_IN_PIPELINE.required,
      options: VAR_ITEM_TEMPLATE_IN_PIPELINE.options,
      allowedTypesAndExtensions: {},
    })
  })

  it('should convert form data back into pipeline input variables', () => {
    const result = convertFormDataToINputField({
      type: PipelineInputVarType.select,
      label: 'Category',
      variable: 'category',
      maxLength: 10,
      default: 'books',
      required: true,
      tooltips: 'Pick one',
      options: ['books', 'music'],
      placeholder: 'Choose',
      unit: '',
      allowedFileUploadMethods: [TransferMethod.local_file],
      allowedTypesAndExtensions: {
        allowedFileTypes: [SupportUploadFileTypes.document],
        allowedFileExtensions: ['txt'],
      },
    })

    expect(result).toEqual({
      type: PipelineInputVarType.select,
      label: 'Category',
      variable: 'category',
      max_length: 10,
      default_value: 'books',
      required: true,
      tooltips: 'Pick one',
      options: ['books', 'music'],
      placeholder: 'Choose',
      unit: '',
      allowed_file_upload_methods: [TransferMethod.local_file],
      allowed_file_types: [SupportUploadFileTypes.document],
      allowed_file_extensions: ['txt'],
    })
  })
})
