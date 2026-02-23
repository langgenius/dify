import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineInputVarType } from '@/models/pipeline'
import { useConfigurations, useHiddenConfigurations, useHiddenFieldNames } from '../hooks'

vi.mock('@/app/components/base/file-uploader/hooks', () => ({
  useFileSizeLimit: () => ({
    imgSizeLimit: 10 * 1024 * 1024,
    docSizeLimit: 15 * 1024 * 1024,
    audioSizeLimit: 50 * 1024 * 1024,
    videoSizeLimit: 100 * 1024 * 1024,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({ data: {} }),
}))

vi.mock('@/app/components/workflow/constants', () => ({
  DEFAULT_FILE_UPLOAD_SETTING: {
    allowed_file_upload_methods: ['local_file', 'remote_url'],
    allowed_file_types: ['image', 'document'],
    allowed_file_extensions: ['.jpg', '.png', '.pdf'],
    max_length: 5,
  },
}))

vi.mock('../schema', () => ({
  TEXT_MAX_LENGTH: 256,
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${Math.round(size / 1024 / 1024)}MB`,
}))

describe('useHiddenFieldNames', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return field names for textInput type', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.textInput))

    expect(result.current).toContain('variableconfig.defaultvalue')
    expect(result.current).toContain('variableconfig.placeholder')
    expect(result.current).toContain('variableconfig.tooltips')
  })

  it('should return field names for paragraph type', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.paragraph))

    expect(result.current).toContain('variableconfig.defaultvalue')
    expect(result.current).toContain('variableconfig.placeholder')
    expect(result.current).toContain('variableconfig.tooltips')
  })

  it('should return field names for number type including unit', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.number))

    expect(result.current).toContain('appdebug.variableconfig.defaultvalue')
    expect(result.current).toContain('appdebug.variableconfig.unit')
    expect(result.current).toContain('appdebug.variableconfig.placeholder')
    expect(result.current).toContain('appdebug.variableconfig.tooltips')
  })

  it('should return field names for select type', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.select))

    expect(result.current).toContain('appdebug.variableconfig.defaultvalue')
    expect(result.current).toContain('appdebug.variableconfig.tooltips')
  })

  it('should return field names for singleFile type', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.singleFile))

    expect(result.current).toContain('appdebug.variableconfig.uploadmethod')
    expect(result.current).toContain('appdebug.variableconfig.tooltips')
  })

  it('should return field names for multiFiles type including max number', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.multiFiles))

    expect(result.current).toContain('appdebug.variableconfig.uploadmethod')
    expect(result.current).toContain('appdebug.variableconfig.maxnumberofuploads')
    expect(result.current).toContain('appdebug.variableconfig.tooltips')
  })

  it('should return field names for checkbox type', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.checkbox))

    expect(result.current).toContain('appdebug.variableconfig.startchecked')
    expect(result.current).toContain('appdebug.variableconfig.tooltips')
  })

  it('should return only tooltips for unknown type', () => {
    const { result } = renderHook(() => useHiddenFieldNames('unknown-type' as PipelineInputVarType))

    expect(result.current).toBe('appdebug.variableconfig.tooltips')
  })

  it('should return comma-separated lowercase string', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.textInput))

    expect(result.current).toMatch(/,/)
    expect(result.current).toBe(result.current.toLowerCase())
  })
})

describe('useConfigurations', () => {
  let mockGetFieldValue: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>
  let mockSetFieldValue: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>

  beforeEach(() => {
    mockGetFieldValue = vi.fn()
    mockSetFieldValue = vi.fn()
    vi.clearAllMocks()
  })

  it('should return array of configurations', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    expect(Array.isArray(result.current)).toBe(true)
    expect(result.current.length).toBeGreaterThan(0)
  })

  it('should include field type select configuration', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const typeConfig = result.current.find(c => c.variable === 'type')
    expect(typeConfig).toBeDefined()
    expect(typeConfig?.required).toBe(true)
  })

  it('should include variable name configuration', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const varConfig = result.current.find(c => c.variable === 'variable')
    expect(varConfig).toBeDefined()
    expect(varConfig?.required).toBe(true)
  })

  it('should include display name configuration', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const labelConfig = result.current.find(c => c.variable === 'label')
    expect(labelConfig).toBeDefined()
    expect(labelConfig?.required).toBe(false)
  })

  it('should include required checkbox configuration', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const requiredConfig = result.current.find(c => c.variable === 'required')
    expect(requiredConfig).toBeDefined()
  })

  it('should set file defaults when type changes to singleFile', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const typeConfig = result.current.find(c => c.variable === 'type')
    typeConfig?.listeners?.onChange?.({ value: PipelineInputVarType.singleFile, fieldApi: {} as never })

    expect(mockSetFieldValue).toHaveBeenCalledWith('allowedFileUploadMethods', ['local_file', 'remote_url'])
    expect(mockSetFieldValue).toHaveBeenCalledWith('allowedTypesAndExtensions', {
      allowedFileTypes: ['image', 'document'],
      allowedFileExtensions: ['.jpg', '.png', '.pdf'],
    })
  })

  it('should set maxLength when type changes to multiFiles', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const typeConfig = result.current.find(c => c.variable === 'type')
    typeConfig?.listeners?.onChange?.({ value: PipelineInputVarType.multiFiles, fieldApi: {} as never })

    expect(mockSetFieldValue).toHaveBeenCalledWith('maxLength', 5)
  })

  it('should not set file defaults when type changes to text', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const typeConfig = result.current.find(c => c.variable === 'type')
    typeConfig?.listeners?.onChange?.({ value: PipelineInputVarType.textInput, fieldApi: {} as never })

    expect(mockSetFieldValue).not.toHaveBeenCalled()
  })

  it('should auto-fill label from variable name on blur', () => {
    mockGetFieldValue.mockReturnValue('')

    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const varConfig = result.current.find(c => c.variable === 'variable')
    varConfig?.listeners?.onBlur?.({ value: 'myVariable', fieldApi: {} as never })

    expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'myVariable')
  })

  it('should not auto-fill label if label already exists', () => {
    mockGetFieldValue.mockReturnValue('Existing Label')

    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const varConfig = result.current.find(c => c.variable === 'variable')
    varConfig?.listeners?.onBlur?.({ value: 'myVariable', fieldApi: {} as never })

    expect(mockSetFieldValue).not.toHaveBeenCalled()
  })

  it('should reset label to variable name when display name is cleared', () => {
    mockGetFieldValue.mockReturnValue('existingVar')

    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const labelConfig = result.current.find(c => c.variable === 'label')
    labelConfig?.listeners?.onBlur?.({ value: '', fieldApi: {} as never })

    expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'existingVar')
  })
})

describe('useHiddenConfigurations', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return array of hidden configurations', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: undefined }),
    )

    expect(Array.isArray(result.current)).toBe(true)
    expect(result.current.length).toBeGreaterThan(0)
  })

  it('should include default value config for textInput', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: undefined }),
    )

    const defaultConfigs = result.current.filter(c => c.variable === 'default')
    expect(defaultConfigs.length).toBeGreaterThan(0)
  })

  it('should include tooltips configuration for all types', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: undefined }),
    )

    const tooltipsConfig = result.current.find(c => c.variable === 'tooltips')
    expect(tooltipsConfig).toBeDefined()
    expect(tooltipsConfig?.showConditions).toEqual([])
  })

  it('should build select options from provided options', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: ['opt1', 'opt2'] }),
    )

    const selectDefault = result.current.find(
      c => c.variable === 'default' && c.showConditions?.some(sc => sc.value === PipelineInputVarType.select),
    )
    expect(selectDefault?.options).toBeDefined()
    expect(selectDefault?.options?.[0]?.value).toBe('')
    expect(selectDefault?.options?.[1]?.value).toBe('opt1')
    expect(selectDefault?.options?.[2]?.value).toBe('opt2')
  })

  it('should return empty options when options prop is undefined', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: undefined }),
    )

    const selectDefault = result.current.find(
      c => c.variable === 'default' && c.showConditions?.some(sc => sc.value === PipelineInputVarType.select),
    )
    expect(selectDefault?.options).toEqual([])
  })

  it('should include upload method configs for file types', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: undefined }),
    )

    const uploadMethods = result.current.filter(c => c.variable === 'allowedFileUploadMethods')
    expect(uploadMethods.length).toBe(2) // singleFile + multiFiles
  })

  it('should include maxLength slider for multiFiles', () => {
    const { result } = renderHook(() =>
      useHiddenConfigurations({ options: undefined }),
    )

    const maxLength = result.current.find(
      c => c.variable === 'maxLength' && c.showConditions?.some(sc => sc.value === PipelineInputVarType.multiFiles),
    )
    expect(maxLength).toBeDefined()
    expect(maxLength?.description).toBeDefined()
  })
})
