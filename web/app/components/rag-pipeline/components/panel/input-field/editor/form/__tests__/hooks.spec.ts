import { describe, expect, it } from 'vite-plus/test'
import { PipelineInputVarType } from '@/models/pipeline'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { useHiddenConfigurations, useHiddenFieldNames } from '../hooks'

describe('useHiddenFieldNames', () => {
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

describe('useHiddenConfigurations', () => {
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
