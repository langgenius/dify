import type { RAGPipelineVariables } from '@/models/pipeline'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { useConfigurations, useInitialData } from '../use-input-fields'

vi.mock('@/models/pipeline', () => ({
  VAR_TYPE_MAP: {
    'text-input': BaseFieldType.textInput,
    'paragraph': BaseFieldType.paragraph,
    'select': BaseFieldType.select,
    'number': BaseFieldType.numberInput,
    'checkbox': BaseFieldType.checkbox,
    'file': BaseFieldType.file,
    'file-list': BaseFieldType.fileList,
  },
}))

const makeVariable = (overrides: Record<string, unknown> = {}) => ({
  variable: 'test_var',
  label: 'Test Variable',
  type: 'text-input',
  required: true,
  max_length: 100,
  options: undefined,
  placeholder: '',
  tooltips: '',
  unit: '',
  default_value: undefined,
  allowed_file_types: undefined,
  allowed_file_extensions: undefined,
  allowed_file_upload_methods: undefined,
  ...overrides,
})

describe('useInitialData', () => {
  it('should initialize text-input with empty string by default', () => {
    const variables = [makeVariable({ type: 'text-input' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.test_var).toBe('')
  })

  it('should initialize paragraph with empty string by default', () => {
    const variables = [makeVariable({ type: 'paragraph', variable: 'para' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.para).toBe('')
  })

  it('should initialize select with empty string by default', () => {
    const variables = [makeVariable({ type: 'select', variable: 'sel' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.sel).toBe('')
  })

  it('should initialize number with 0 by default', () => {
    const variables = [makeVariable({ type: 'number', variable: 'num' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.num).toBe(0)
  })

  it('should initialize checkbox with false by default', () => {
    const variables = [makeVariable({ type: 'checkbox', variable: 'cb' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.cb).toBe(false)
  })

  it('should initialize file with empty array by default', () => {
    const variables = [makeVariable({ type: 'file', variable: 'f' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.f).toEqual([])
  })

  it('should initialize file-list with empty array by default', () => {
    const variables = [makeVariable({ type: 'file-list', variable: 'fl' })] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.fl).toEqual([])
  })

  it('should use default_value from variable when available', () => {
    const variables = [
      makeVariable({ type: 'text-input', default_value: 'hello' }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.test_var).toBe('hello')
  })

  it('should prefer lastRunInputData over default_value', () => {
    const variables = [
      makeVariable({ type: 'text-input', default_value: 'default' }),
    ] as unknown as RAGPipelineVariables
    const lastRunInputData = { test_var: 'last-run-value' }
    const { result } = renderHook(() => useInitialData(variables, lastRunInputData))

    expect(result.current.test_var).toBe('last-run-value')
  })

  it('should handle multiple variables', () => {
    const variables = [
      makeVariable({ type: 'text-input', variable: 'name', default_value: 'Alice' }),
      makeVariable({ type: 'number', variable: 'age', default_value: 25 }),
      makeVariable({ type: 'checkbox', variable: 'agree' }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useInitialData(variables))

    expect(result.current.name).toBe('Alice')
    expect(result.current.age).toBe(25)
    expect(result.current.agree).toBe(false)
  })
})

describe('useConfigurations', () => {
  it('should convert variables to BaseConfiguration format', () => {
    const variables = [
      makeVariable({
        type: 'text-input',
        variable: 'name',
        label: 'Name',
        required: true,
        max_length: 50,
        placeholder: 'Enter name',
        tooltips: 'Your full name',
        unit: '',
      }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      type: BaseFieldType.textInput,
      variable: 'name',
      label: 'Name',
      required: true,
      maxLength: 50,
      placeholder: 'Enter name',
      tooltip: 'Your full name',
    })
  })

  it('should map select options correctly', () => {
    const variables = [
      makeVariable({
        type: 'select',
        variable: 'color',
        options: ['red', 'green', 'blue'],
      }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current[0].options).toEqual([
      { label: 'red', value: 'red' },
      { label: 'green', value: 'green' },
      { label: 'blue', value: 'blue' },
    ])
  })

  it('should handle undefined options', () => {
    const variables = [
      makeVariable({ type: 'text-input' }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current[0].options).toBeUndefined()
  })

  it('should include file-related fields for file type', () => {
    const variables = [
      makeVariable({
        type: 'file',
        variable: 'doc',
        allowed_file_types: ['pdf', 'docx'],
        allowed_file_extensions: ['.pdf', '.docx'],
        allowed_file_upload_methods: ['local', 'remote'],
      }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current[0].allowedFileTypes).toEqual(['pdf', 'docx'])
    expect(result.current[0].allowedFileExtensions).toEqual(['.pdf', '.docx'])
    expect(result.current[0].allowedFileUploadMethods).toEqual(['local', 'remote'])
  })

  it('should include showConditions as empty array', () => {
    const variables = [
      makeVariable(),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current[0].showConditions).toEqual([])
  })

  it('should handle multiple variables', () => {
    const variables = [
      makeVariable({ variable: 'a', type: 'text-input' }),
      makeVariable({ variable: 'b', type: 'number' }),
      makeVariable({ variable: 'c', type: 'checkbox' }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current).toHaveLength(3)
    expect(result.current[0].variable).toBe('a')
    expect(result.current[1].variable).toBe('b')
    expect(result.current[2].variable).toBe('c')
  })

  it('should include unit field', () => {
    const variables = [
      makeVariable({ type: 'number', unit: 'px' }),
    ] as unknown as RAGPipelineVariables
    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current[0].unit).toBe('px')
  })
})
