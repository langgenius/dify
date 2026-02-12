import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../../types'

// Mock invalidation / refresh functions
const mockInvalidateInstalledPluginList = vi.fn()
const mockRefetchLLMModelList = vi.fn()
const mockRefetchEmbeddingModelList = vi.fn()
const mockRefetchRerankModelList = vi.fn()
const mockRefreshModelProviders = vi.fn()
const mockInvalidateAllToolProviders = vi.fn()
const mockInvalidateAllBuiltInTools = vi.fn()
const mockInvalidateAllDataSources = vi.fn()
const mockInvalidateDataSourceListAuth = vi.fn()
const mockInvalidateStrategyProviders = vi.fn()
const mockInvalidateAllTriggerPlugins = vi.fn()
const mockInvalidateRAGRecommendedPlugins = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  ModelTypeEnum: { textGeneration: 'text-generation', textEmbedding: 'text-embedding', rerank: 'rerank' },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: (type: string) => {
    const map: Record<string, { mutate: ReturnType<typeof vi.fn> }> = {
      'text-generation': { mutate: mockRefetchLLMModelList },
      'text-embedding': { mutate: mockRefetchEmbeddingModelList },
      'rerank': { mutate: mockRefetchRerankModelList },
    }
    return map[type] ?? { mutate: vi.fn() }
  },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({ refreshModelProviders: mockRefreshModelProviders }),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateAllToolProviders: () => mockInvalidateAllToolProviders,
  useInvalidateAllBuiltInTools: () => mockInvalidateAllBuiltInTools,
  useInvalidateRAGRecommendedPlugins: () => mockInvalidateRAGRecommendedPlugins,
}))

vi.mock('@/service/use-pipeline', () => ({
  useInvalidDataSourceList: () => mockInvalidateAllDataSources,
}))

vi.mock('@/service/use-datasource', () => ({
  useInvalidDataSourceListAuth: () => mockInvalidateDataSourceListAuth,
}))

vi.mock('@/service/use-strategy', () => ({
  useInvalidateStrategyProviders: () => mockInvalidateStrategyProviders,
}))

vi.mock('@/service/use-triggers', () => ({
  useInvalidateAllTriggerPlugins: () => mockInvalidateAllTriggerPlugins,
}))

const { default: useRefreshPluginList } = await import('../use-refresh-plugin-list')

describe('useRefreshPluginList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should always invalidate installed plugin list', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList()

    expect(mockInvalidateInstalledPluginList).toHaveBeenCalledTimes(1)
  })

  it('should refresh tool providers for tool category manifest', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList({ category: PluginCategoryEnum.tool } as never)

    expect(mockInvalidateAllToolProviders).toHaveBeenCalledTimes(1)
    expect(mockInvalidateAllBuiltInTools).toHaveBeenCalledTimes(1)
    expect(mockInvalidateRAGRecommendedPlugins).toHaveBeenCalledWith('tool')
  })

  it('should refresh model lists for model category manifest', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList({ category: PluginCategoryEnum.model } as never)

    expect(mockRefreshModelProviders).toHaveBeenCalledTimes(1)
    expect(mockRefetchLLMModelList).toHaveBeenCalledTimes(1)
    expect(mockRefetchEmbeddingModelList).toHaveBeenCalledTimes(1)
    expect(mockRefetchRerankModelList).toHaveBeenCalledTimes(1)
  })

  it('should refresh datasource lists for datasource category manifest', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList({ category: PluginCategoryEnum.datasource } as never)

    expect(mockInvalidateAllDataSources).toHaveBeenCalledTimes(1)
    expect(mockInvalidateDataSourceListAuth).toHaveBeenCalledTimes(1)
  })

  it('should refresh trigger plugins for trigger category manifest', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList({ category: PluginCategoryEnum.trigger } as never)

    expect(mockInvalidateAllTriggerPlugins).toHaveBeenCalledTimes(1)
  })

  it('should refresh strategy providers for agent category manifest', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList({ category: PluginCategoryEnum.agent } as never)

    expect(mockInvalidateStrategyProviders).toHaveBeenCalledTimes(1)
  })

  it('should refresh all types when refreshAllType is true', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList(undefined, true)

    expect(mockInvalidateInstalledPluginList).toHaveBeenCalledTimes(1)
    expect(mockInvalidateAllToolProviders).toHaveBeenCalledTimes(1)
    expect(mockInvalidateAllBuiltInTools).toHaveBeenCalledTimes(1)
    expect(mockInvalidateRAGRecommendedPlugins).toHaveBeenCalledWith('tool')
    expect(mockInvalidateAllTriggerPlugins).toHaveBeenCalledTimes(1)
    expect(mockInvalidateAllDataSources).toHaveBeenCalledTimes(1)
    expect(mockInvalidateDataSourceListAuth).toHaveBeenCalledTimes(1)
    expect(mockRefreshModelProviders).toHaveBeenCalledTimes(1)
    expect(mockRefetchLLMModelList).toHaveBeenCalledTimes(1)
    expect(mockRefetchEmbeddingModelList).toHaveBeenCalledTimes(1)
    expect(mockRefetchRerankModelList).toHaveBeenCalledTimes(1)
    expect(mockInvalidateStrategyProviders).toHaveBeenCalledTimes(1)
  })

  it('should not refresh category-specific lists when manifest is null', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList(null)

    expect(mockInvalidateInstalledPluginList).toHaveBeenCalledTimes(1)
    expect(mockInvalidateAllToolProviders).not.toHaveBeenCalled()
    expect(mockRefreshModelProviders).not.toHaveBeenCalled()
    expect(mockInvalidateAllDataSources).not.toHaveBeenCalled()
    expect(mockInvalidateAllTriggerPlugins).not.toHaveBeenCalled()
    expect(mockInvalidateStrategyProviders).not.toHaveBeenCalled()
  })

  it('should not refresh unrelated categories for a specific manifest', () => {
    const { result } = renderHook(() => useRefreshPluginList())

    result.current.refreshPluginList({ category: PluginCategoryEnum.tool } as never)

    expect(mockInvalidateAllToolProviders).toHaveBeenCalledTimes(1)
    expect(mockRefreshModelProviders).not.toHaveBeenCalled()
    expect(mockInvalidateAllDataSources).not.toHaveBeenCalled()
    expect(mockInvalidateAllTriggerPlugins).not.toHaveBeenCalled()
    expect(mockInvalidateStrategyProviders).not.toHaveBeenCalled()
  })
})
