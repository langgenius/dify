import type { CommonNodeType } from '../../types'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { CollectionType } from '@/app/components/tools/types'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createTestQueryClient } from '@/test/query-client'
import { renderWorkflowHook as renderHookBase } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useNodePluginInstallation } from '../use-node-plugin-installation'

const mockBuiltInTools = vi.fn()
const mockCustomTools = vi.fn()
const mockWorkflowTools = vi.fn()
const mockMcpTools = vi.fn()
const mockTriggerPlugins = vi.fn()
const mockInvalidateTriggers = vi.fn()
let mockWorkspacePermissionKeys = ['plugin.install']

const renderWorkflowHook: typeof renderHookBase = (callback, options) => {
  const { queryClient } = createConsoleQueryWrapper({
    queryClient: options?.queryClient,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  })
  return renderHookBase(callback, { ...options, queryClient })
}

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: (enabled: boolean) => mockTriggerPlugins(enabled),
  useInvalidateAllTriggerPlugins: () => mockInvalidateTriggers,
}))

const makeToolNode = (overrides: Partial<CommonNodeType> = {}) =>
  ({
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

const makeTriggerNode = (overrides: Partial<CommonNodeType> = {}) =>
  ({
    type: BlockEnum.TriggerPlugin,
    title: 'Trigger node',
    desc: '',
    provider_id: 'trigger-provider',
    provider_name: 'trigger-provider',
    plugin_id: 'trigger-plugin',
    plugin_unique_identifier: 'trigger-plugin@1.0.0',
    ...overrides,
  }) as CommonNodeType

const makeDataSourceNode = (overrides: Partial<CommonNodeType> = {}) =>
  ({
    type: BlockEnum.DataSource,
    title: 'Data source node',
    desc: '',
    provider_name: 'knowledge-provider',
    plugin_id: 'knowledge-plugin',
    plugin_unique_identifier: 'knowledge-plugin@1.0.0',
    ...overrides,
  }) as CommonNodeType

const matchedTool = createToolProviderFixture({
  plugin_id: 'plugin-search',
  id: 'search',
  name: 'search',
  plugin_unique_identifier: 'plugin-search@1.0.0',
})

const matchedTriggerProvider = {
  id: 'trigger-provider',
  name: 'trigger-provider',
  plugin_id: 'trigger-plugin',
}

const matchedDataSource = createDatasourceProvider({
  provider: 'knowledge-provider',
  plugin_id: 'knowledge-plugin',
  plugin_unique_identifier: 'knowledge-plugin@1.0.0',
})

describe('useNodePluginInstallation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = ['plugin.install']
    mockBuiltInTools.mockReturnValue(new Promise(() => {}))
    mockCustomTools.mockReturnValue(new Promise(() => {}))
    mockWorkflowTools.mockReturnValue(new Promise(() => {}))
    mockMcpTools.mockReturnValue(new Promise(() => {}))
    mockTriggerPlugins.mockReturnValue({ data: undefined, isLoading: false })
    mockInvalidateTriggers.mockReset()
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
    const queryClient = createTestQueryClient()
    seedAccountProfileQuery(queryClient)
    const builtInToolsKey = consoleQuery.workspaces.current.tools.builtin.get.queryKey()
    const customToolsKey = consoleQuery.workspaces.current.tools.api.get.queryKey()
    queryClient.setQueryData(customToolsKey, [])

    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeToolNode()), {
      queryClient,
    })

    expect(mockBuiltInTools).toHaveBeenCalledTimes(1)
    expect(mockCustomTools).not.toHaveBeenCalled()
    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.uniqueIdentifier).toBe('plugin-search@1.0.0')
    expect(result.current.canInstall).toBe(true)
    expect(result.current.shouldDim).toBe(true)

    act(() => {
      result.current.onInstallSuccess()
    })

    expect(queryClient.getQueryState(builtInToolsKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(customToolsKey)?.isInvalidated).toBe(false)
  })

  it.each([
    [CollectionType.custom, mockCustomTools],
    [CollectionType.workflow, mockWorkflowTools],
    [CollectionType.mcp, mockMcpTools],
  ])(
    'should resolve matched %s tool collections without dimming',
    async (providerType, hookMock) => {
      hookMock.mockResolvedValue([matchedTool])

      const { result } = renderWorkflowHook(() =>
        useNodePluginInstallation(makeToolNode({ provider_type: providerType })),
      )

      await waitFor(() => expect(result.current.isChecking).toBe(false))
      expect(result.current.isMissing).toBe(false)
      expect(result.current.shouldDim).toBe(false)
    },
  )

  it('should keep plugin tool collections installable without collection state', () => {
    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(
        makeToolNode({
          provider_type: 'plugin',
          plugin_unique_identifier: undefined,
          plugin_id: undefined,
          provider_id: 'legacy-provider',
        }),
      ),
    )

    expect(result.current.isChecking).toBe(false)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.uniqueIdentifier).toBe('legacy-provider')
    expect(result.current.canInstall).toBe(false)
    expect(result.current.shouldDim).toBe(false)
  })

  it('should not allow installing missing tool plugins without plugin install permission', async () => {
    mockWorkspacePermissionKeys = []
    mockBuiltInTools.mockResolvedValue([])

    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeToolNode()))

    await waitFor(() => expect(result.current.isMissing).toBe(true))
    expect(result.current.uniqueIdentifier).toBe('plugin-search@1.0.0')
    expect(result.current.canInstall).toBe(false)
  })

  it('should flag missing trigger plugins and invalidate trigger data after installation', () => {
    mockTriggerPlugins.mockReturnValue({ data: [matchedTriggerProvider], isLoading: false })

    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(
        makeTriggerNode({
          provider_id: 'missing-trigger',
          provider_name: 'missing-trigger',
          plugin_id: 'missing-trigger',
        }),
      ),
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
      useNodePluginInstallation(
        makeTriggerNode({ plugin_unique_identifier: undefined, plugin_id: 'trigger-plugin' }),
      ),
    )

    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.uniqueIdentifier).toBe('trigger-plugin')
    expect(result.current.canInstall).toBe(false)
    expect(result.current.shouldDim).toBe(true)
  })

  it('should track missing and matched data source providers based on workflow store state', () => {
    const missingRender = renderWorkflowHook(
      () =>
        useNodePluginInstallation(
          makeDataSourceNode({
            provider_name: 'missing-provider',
            plugin_id: 'missing-plugin',
            plugin_unique_identifier: 'missing-plugin@1.0.0',
          }),
        ),
      {
        initialStoreState: {
          dataSourceList: [matchedDataSource],
        },
      },
    )

    expect(missingRender.result.current.isChecking).toBe(false)
    expect(missingRender.result.current.isMissing).toBe(true)
    expect(missingRender.result.current.shouldDim).toBe(true)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    seedAccountProfileQuery(queryClient)
    const catalogKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
    queryClient.setQueryData(catalogKey, [matchedDataSource])
    const matchedRender = renderWorkflowHook(
      () => useNodePluginInstallation(makeDataSourceNode()),
      {
        queryClient,
        initialStoreState: {
          dataSourceList: [matchedDataSource],
        },
      },
    )

    expect(matchedRender.result.current.isMissing).toBe(false)
    expect(matchedRender.result.current.shouldDim).toBe(false)

    act(() => {
      matchedRender.result.current.onInstallSuccess()
    })

    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('should keep data sources in checking state before the list is loaded', () => {
    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeDataSourceNode()))

    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.shouldDim).toBe(true)
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': (input) => mockBuiltInTools(input),
      'workspaces.current.tools.api.get': (input) => mockCustomTools(input),
      'workspaces.current.tools.workflow.get': (input) => mockWorkflowTools(input),
      'workspaces.current.tools.mcp.get': (input) => mockMcpTools(input),
    }),
  }
})
