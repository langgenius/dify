import { renderHook } from '@testing-library/react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { createPipelineVariable } from '@/test/pipeline-variables'
import { TransferMethod } from '@/types/app'
import { useConfigurations, useInitialData } from '../use-input-fields'

it.each([
  [PipelineInputVarType.textInput, ''],
  [PipelineInputVarType.paragraph, ''],
  [PipelineInputVarType.select, ''],
  [PipelineInputVarType.number, 0],
  [PipelineInputVarType.checkbox, false],
  [PipelineInputVarType.singleFile, []],
  [PipelineInputVarType.multiFiles, []],
] as const)('initializes %s with its typed empty value', (type, expected) => {
  const variables = [createPipelineVariable({ type, default_value: undefined })]
  const { result } = renderHook(() => useInitialData(variables))
  expect(result.current).toEqual({ source: expected })
})

it('combines defaults with saved inputs without losing unrelated field defaults', () => {
  const variables = [
    createPipelineVariable({ variable: 'name', default_value: 'Alice' }),
    createPipelineVariable({
      variable: 'count',
      type: PipelineInputVarType.number,
      default_value: 25,
    }),
    createPipelineVariable({
      variable: 'agreed',
      type: PipelineInputVarType.checkbox,
      default_value: false,
    }),
  ]
  const { result } = renderHook(() => useInitialData(variables, { name: 'Bob' }))
  expect(result.current).toEqual({ name: 'Bob', count: 25, agreed: false })
})

it('maps labels, validation, selection and upload settings into form configurations in order', () => {
  const variables = [
    createPipelineVariable({
      variable: 'name',
      label: 'Name',
      max_length: 50,
      placeholder: 'Enter name',
      tooltips: 'Full name',
      options: undefined,
    }),
    createPipelineVariable({
      variable: 'category',
      type: PipelineInputVarType.select,
      options: ['red', 'green'],
    }),
    createPipelineVariable({
      variable: 'file',
      type: PipelineInputVarType.singleFile,
      allowed_file_types: [SupportUploadFileTypes.document],
      allowed_file_extensions: ['.pdf'],
      allowed_file_upload_methods: [TransferMethod.local_file],
    }),
    createPipelineVariable({ variable: 'weight', type: PipelineInputVarType.number, unit: 'kg' }),
  ]
  const { result } = renderHook(() => useConfigurations(variables))
  expect(result.current).toEqual([
    expect.objectContaining({
      type: BaseFieldType.textInput,
      variable: 'name',
      label: 'Name',
      required: true,
      maxLength: 50,
      placeholder: 'Enter name',
      tooltip: 'Full name',
      options: undefined,
      showConditions: [],
    }),
    expect.objectContaining({
      type: BaseFieldType.select,
      variable: 'category',
      options: [
        { label: 'red', value: 'red' },
        { label: 'green', value: 'green' },
      ],
    }),
    expect.objectContaining({
      type: BaseFieldType.file,
      variable: 'file',
      allowedFileTypes: ['document'],
      allowedFileExtensions: ['.pdf'],
      allowedFileUploadMethods: ['local_file'],
    }),
    expect.objectContaining({ type: BaseFieldType.numberInput, variable: 'weight', unit: 'kg' }),
  ])
})
