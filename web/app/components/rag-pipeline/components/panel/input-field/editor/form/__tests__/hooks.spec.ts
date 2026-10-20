import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { PipelineInputVarType } from '@/models/pipeline'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { useConfigurations, useHiddenConfigurations, useHiddenFieldNames } from '../hooks'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => ({
        image_file_size_limit: 10,
        file_size_limit: 15,
        audio_file_size_limit: 50,
        video_file_size_limit: 100,
      }),
    }),
  }
})

describe('useHiddenFieldNames', () => {
  afterEach(() => {
    vi.clearAllMocks()
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

  it('should return field names for checkbox type', () => {
    const { result } = renderHook(() => useHiddenFieldNames(PipelineInputVarType.checkbox))

    expect(result.current).toContain('appdebug.variableconfig.startchecked')
    expect(result.current).toContain('appdebug.variableconfig.tooltips')
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

  it('should set file defaults when type changes to singleFile', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const typeConfig = result.current.find((c) => c.variable === 'type')
    typeConfig?.listeners?.onChange?.({
      value: PipelineInputVarType.singleFile,
      fieldApi: {} as never,
    })

    expect(mockSetFieldValue).toHaveBeenCalledWith(
      'allowedFileUploadMethods',
      DEFAULT_FILE_UPLOAD_SETTING.allowed_file_upload_methods,
    )
    expect(mockSetFieldValue).toHaveBeenCalledWith('allowedTypesAndExtensions', {
      allowedFileTypes: DEFAULT_FILE_UPLOAD_SETTING.allowed_file_types,
      allowedFileExtensions: DEFAULT_FILE_UPLOAD_SETTING.allowed_file_extensions,
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

    const typeConfig = result.current.find((c) => c.variable === 'type')
    typeConfig?.listeners?.onChange?.({
      value: PipelineInputVarType.multiFiles,
      fieldApi: {} as never,
    })

    expect(mockSetFieldValue).toHaveBeenCalledWith(
      'maxLength',
      DEFAULT_FILE_UPLOAD_SETTING.max_length,
    )
  })

  it('should not set file defaults when type changes to text', () => {
    const { result } = renderHook(() =>
      useConfigurations({
        getFieldValue: mockGetFieldValue,
        setFieldValue: mockSetFieldValue,
        supportFile: true,
      }),
    )

    const typeConfig = result.current.find((c) => c.variable === 'type')
    typeConfig?.listeners?.onChange?.({
      value: PipelineInputVarType.textInput,
      fieldApi: {} as never,
    })

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

    const labelConfig = result.current.find((c) => c.variable === 'label')
    labelConfig?.listeners?.onBlur?.({ value: '', fieldApi: {} as never })

    expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'existingVar')
  })
})

describe('useHiddenConfigurations', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should include tooltips configuration for all types', () => {
    const { result } = renderHook(() => useHiddenConfigurations({ options: undefined }))

    const tooltipsConfig = result.current.find((c) => c.variable === 'tooltips')
    expect(tooltipsConfig).toBeDefined()
    expect(tooltipsConfig?.showConditions).toEqual([])
  })

  it('should build select options from provided options', () => {
    const { result } = renderHook(() => useHiddenConfigurations({ options: ['opt1', 'opt2'] }))

    const selectDefault = result.current.find(
      (c) =>
        c.variable === 'default' &&
        c.showConditions?.some((sc) => sc.value === PipelineInputVarType.select),
    )
    expect(selectDefault?.options).toEqual([
      { value: '', label: 'appDebug.variableConfig.noDefaultSelected' },
      { value: 'opt1', label: 'opt1' },
      { value: 'opt2', label: 'opt2' },
    ])
  })

  it('should return empty options when options prop is undefined', () => {
    const { result } = renderHook(() => useHiddenConfigurations({ options: undefined }))

    const selectDefault = result.current.find(
      (c) =>
        c.variable === 'default' &&
        c.showConditions?.some((sc) => sc.value === PipelineInputVarType.select),
    )
    expect(selectDefault?.options).toEqual([])
  })
})
