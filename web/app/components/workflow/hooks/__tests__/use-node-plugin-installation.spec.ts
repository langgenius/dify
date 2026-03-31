import type { CommonNodeType } from '../../types'
import { act } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useNodePluginInstallation } from '../use-node-plugin-installation'

const mockBuiltInTools = vi.fn()
const mockCustomTools = vi.fn()
const mockWorkflowTools = vi.fn()
const mockMcpTools = vi.fn()
const mockInvalidToolsByType = vi.fn()
const mockTriggerPlugins = vi.fn()
const mockInvalidateTriggers = vi.fn()
const mockInvalidDataSourceList = vi.fn()

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: (enabled: boolean) => mockBuiltInTools(enabled),
  useAllCustomTools: (enabled: boolean) => mockCustomTools(enabled),
  useAllWorkflowTools: (enabled: boolean) => mockWorkflowTools(enabled),
  useAllMCPTools: (enabled: boolean) => mockMcpTools(enabled),
  useInvalidToolsByType: (providerType?: string) => mockInvalidToolsByType(providerType),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: (enabled: boolean) => mockTriggerPlugins(enabled),
  useInvalidateAllTriggerPlugins: () => mockInvalidateTriggers,
}))

vi.mock('@/service/use-pipeline', () => ({
  useInvalidDataSourceList: () => mockInvalidDataSourceList,
}))

const makeToolNode = (overrides: Partial<CommonNodeType> = {}) => ({
  type: BlockEnum.Tool,
  title: 'Tool node',
  desc: '',
  provider_type: CollectionType.builtIn,
  provider_id: 'search',
  provider_name: 'search',
  plugin_id: 'plugin-search',
  plugin_unique_identifier: 'plugin-search@1.0.0',
  ...overrides,
}) as CommonNodeType

const makeTriggerNode = (overrides: Partial<CommonNodeType> = {}) => ({
  type: BlockEnum.TriggerPlugin,
  title: 'Trigger node',
  desc: '',
  provider_id: 'trigger-provider',
  provider_name: 'trigger-provider',
  plugin_id: 'trigger-plugin',
  plugin_unique_identifier: 'trigger-plugin@1.0.0',
  ...overrides,
}) as CommonNodeType

const makeDataSourceNode = (overrides: Partial<CommonNodeType> = {}) => ({
  type: BlockEnum.DataSource,
  title: 'Data source node',
  desc: '',
  provider_name: 'knowledge-provider',
  plugin_id: 'knowledge-plugin',
  plugin_unique_identifier: 'knowledge-plugin@1.0.0',
  ...overrides,
}) as CommonNodeType

const matchedTool = {
  plugin_id: 'plugin-search',
  provider: 'search',
  name: 'search',
  plugin_unique_identifier: 'plugin-search@1.0.0',
}

const matchedTriggerProvider = {
  id: 'trigger-provider',
  name: 'trigger-provider',
  plugin_id: 'trigger-plugin',
}

const matchedDataSource = {
  provider: 'knowledge-provider',
  plugin_id: 'knowledge-plugin',
  plugin_unique_identifier: 'knowledge-plugin@1.0.0',
}

describe('useNodePluginInstallation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuiltInTools.mockReturnValue({ data: undefined, isLoading: false })
    mockCustomTools.mockReturnValue({ data: undefined, isLoading: false })
    mockWorkflowTools.mockReturnValue({ data: undefined, isLoading: false })
    mockMcpTools.mockReturnValue({ data: undefined, isLoading: false })
    mockInvalidToolsByType.mockReturnValue(undefined)
    mockTriggerPlugins.mockReturnValue({ data: undefined, isLoading: false })
    mockInvalidateTriggers.mockReset()
    mockInvalidDataSourceList.mockReset()
  })

  it('should return the noop installation state for non plugin-dependent nodes', () => {
    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation({
        type: BlockEnum.LLM,
        title: 'LLM',
        desc: '',
      } as CommonNodeType),
    )

    expect(result.current).toEqual({
      isChecking: false,
      isMissing: false,
      uniqueIdentifier: undefined,
      canInstall: false,
      onInstallSuccess: expect.any(Function),
      shouldDim: false,
    })
  })

  it('should report loading and invalidate built-in tools while the collection is resolving', () => {
    const invalidateTools = vi.fn()
    mockBuiltInTools.mockReturnValue({ data: undefined, isLoading: true })
    mockInvalidToolsByType.mockReturnValue(invalidateTools)

    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeToolNode()))

    expect(mockBuiltInTools).toHaveBeenCalledWith(true)
    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.uniqueIdentifier).toBe('plugin-search@1.0.0')
    expect(result.current.canInstall).toBe(true)
    expect(result.current.shouldDim).toBe(true)

    act(() => {
      result.current.onInstallSuccess()
    })

    expect(invalidateTools).toHaveBeenCalled()
  })

  it.each([
    [CollectionType.custom, mockCustomTools],
    [CollectionType.workflow, mockWorkflowTools],
    [CollectionType.mcp, mockMcpTools],
  ])('should resolve matched %s tool collections without dimming', (providerType, hookMock) => {
    hookMock.mockReturnValue({ data: [matchedTool], isLoading: false })

    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(makeToolNode({ provider_type: providerType })),
    )

    expect(result.current.isChecking).toBe(false)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.shouldDim).toBe(false)
  })

  it('should keep unknown tool collection types installable without collection state', () => {
    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(makeToolNode({
        provider_type: 'unknown' as CollectionType,
        plugin_unique_identifier: undefined,
        plugin_id: undefined,
        provider_id: 'legacy-provider',
      })),
    )

    expect(result.current.isChecking).toBe(false)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.uniqueIdentifier).toBe('legacy-provider')
    expect(result.current.canInstall).toBe(false)
    expect(result.current.shouldDim).toBe(false)
  })

  it('should flag missing trigger plugins and invalidate trigger data after installation', () => {
    mockTriggerPlugins.mockReturnValue({ data: [matchedTriggerProvider], isLoading: false })

    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(makeTriggerNode({
        provider_id: 'missing-trigger',
        provider_name: 'missing-trigger',
        plugin_id: 'missing-trigger',
      })),
    )

    expect(mockTriggerPlugins).toHaveBeenCalledWith(true)
    expect(result.current.isChecking).toBe(false)
    expect(result.current.isMissing).toBe(true)
    expect(result.current.shouldDim).toBe(true)

    act(() => {
      result.current.onInstallSuccess()
    })

    expect(mockInvalidateTriggers).toHaveBeenCalled()
  })

  it('should treat the trigger plugin list as still loading when it has not resolved yet', () => {
    mockTriggerPlugins.mockReturnValue({ data: undefined, isLoading: true })

    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(makeTriggerNode({ plugin_unique_identifier: undefined, plugin_id: 'trigger-plugin' })),
    )

    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.uniqueIdentifier).toBe('trigger-plugin')
    expect(result.current.canInstall).toBe(false)
    expect(result.current.shouldDim).toBe(true)
  })

  it('should track missing and matched data source providers based on workflow store state', () => {
    const missingRender = renderWorkflowHook(
      () => useNodePluginInstallation(makeDataSourceNode({
        provider_name: 'missing-provider',
        plugin_id: 'missing-plugin',
        plugin_unique_identifier: 'missing-plugin@1.0.0',
      })),
      {
        initialStoreState: {
          dataSourceList: [matchedDataSource] as never,
        },
      },
    )

    expect(missingRender.result.current.isChecking).toBe(false)
    expect(missingRender.result.current.isMissing).toBe(true)
    expect(missingRender.result.current.shouldDim).toBe(true)

    const matchedRender = renderWorkflowHook(
      () => useNodePluginInstallation(makeDataSourceNode()),
      {
        initialStoreState: {
          dataSourceList: [matchedDataSource] as never,
        },
      },
    )

    expect(matchedRender.result.current.isMissing).toBe(false)
    expect(matchedRender.result.current.shouldDim).toBe(false)

    act(() => {
      matchedRender.result.current.onInstallSuccess()
    })

    expect(mockInvalidDataSourceList).toHaveBeenCalled()
  })

  it('should keep data sources in checking state before the list is loaded', () => {
    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeDataSourceNode()))

    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.shouldDim).toBe(true)
  })
})
