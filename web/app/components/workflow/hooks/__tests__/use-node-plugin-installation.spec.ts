import type { CommonNodeType } from '../../types'
import { zTriggerProviderApiEntity } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, waitFor } from '@testing-library/react'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { CollectionType } from '@/app/components/tools/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { renderWorkflowHook as renderHookBase } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useNodePluginInstallation } from '../use-node-plugin-installation'

const mockBuiltInTools = vi.fn()
const mockCustomTools = vi.fn()
const mockWorkflowTools = vi.fn()
const mockMcpTools = vi.fn()
const mockTriggerPlugins = vi.fn()
let mockWorkspacePermissionKeys = ['plugin.install']

const renderWorkflowHook: typeof renderHookBase = (callback, options) => {
  const { queryClient } = createConsoleQueryWrapper({
    queryClient: options?.queryClient,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  })
  return renderHookBase(callback, { ...options, queryClient })
}

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

const matchedTriggerProvider = zTriggerProviderApiEntity.parse({
  name: 'trigger-provider',
  author: 'Dify',
  label: { en_US: 'Mail events' },
  description: { en_US: 'Receive new messages' },
  plugin_id: 'trigger-plugin',
  plugin_unique_identifier: 'trigger-plugin@1.0.0',
  supported_creation_methods: ['MANUAL'],
  events: [
    {
      name: 'received',
      identity: { author: 'Dify', name: 'received', label: { en_US: 'Message received' } },
      description: { en_US: 'A new message has arrived' },
      parameters: [],
      output_schema: { type: 'object', properties: { message: { type: 'string' } } },
    },
  ],
})

const matchedDataSource = createDatasourceProvider({
  provider: 'knowledge-provider',
  plugin_id: 'knowledge-plugin',
  plugin_unique_identifier: 'knowledge-plugin@1.0.0',
})

describe('useNodePluginInstallation', () => {
  beforeEach(() => {
    mockWorkspacePermissionKeys = ['plugin.install']
    mockBuiltInTools.mockReturnValue(new Promise(() => {}))
    mockCustomTools.mockReturnValue(new Promise(() => {}))
    mockWorkflowTools.mockReturnValue(new Promise(() => {}))
    mockMcpTools.mockReturnValue(new Promise(() => {}))
    mockTriggerPlugins.mockReset().mockResolvedValue([])
  })

  it('should return the noop installation state for non plugin-dependent nodes', () => {
    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation({
        type: BlockEnum.LLM,
        title: 'LLM',
        desc: '',
      } as CommonNodeType),
    )

    expect(result.current).toMatchObject({
      isChecking: false,
      isMissing: false,
      uniqueIdentifier: undefined,
      canInstall: false,
      shouldDim: false,
    })
  })

  it('should report loading and refresh built-in tools after installation', async () => {
    let resolve!: (providers: (typeof matchedTool)[]) => void
    const promise = new Promise<(typeof matchedTool)[]>((finish) => {
      resolve = finish
    })
    mockBuiltInTools.mockReturnValueOnce(promise).mockResolvedValue([matchedTool])
    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeToolNode()))

    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.canInstall).toBe(true)
    expect(result.current.shouldDim).toBe(true)
    await act(async () => resolve([]))
    await waitFor(() => expect(result.current.isMissing).toBe(true))

    act(() => result.current.onInstallSuccess())

    await waitFor(() => expect(result.current.shouldDim).toBe(false))
    expect(result.current.isMissing).toBe(false)
    expect(result.current.isChecking).toBe(false)
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

  it('should clear missing trigger and dimming state when installation refreshes the provider', async () => {
    const unrelatedProvider = {
      ...matchedTriggerProvider,
      name: 'calendar-provider',
      plugin_id: 'calendar-plugin',
      plugin_unique_identifier: 'calendar-plugin@1.0.0',
    }
    mockTriggerPlugins
      .mockResolvedValueOnce([unrelatedProvider])
      .mockResolvedValue([unrelatedProvider, matchedTriggerProvider])
    const { result } = renderWorkflowHook(() => useNodePluginInstallation(makeTriggerNode()))

    await waitFor(() => expect(result.current.isMissing).toBe(true))
    expect(result.current.isChecking).toBe(false)
    expect(result.current.shouldDim).toBe(true)
    expect(result.current.canInstall).toBe(true)

    act(() => result.current.onInstallSuccess())

    await waitFor(() => expect(result.current.shouldDim).toBe(false))
    expect(result.current.isMissing).toBe(false)
    expect(result.current.isChecking).toBe(false)
  })

  it('should treat the trigger plugin list as still loading when it has not resolved yet', async () => {
    let resolve!: (providers: (typeof matchedTriggerProvider)[]) => void
    const promise = new Promise<(typeof matchedTriggerProvider)[]>((finish) => {
      resolve = finish
    })
    mockTriggerPlugins.mockReturnValueOnce(promise)
    const { result } = renderWorkflowHook(() =>
      useNodePluginInstallation(
        makeTriggerNode({ plugin_unique_identifier: undefined, plugin_id: 'trigger-plugin' }),
      ),
    )

    expect(result.current.isChecking).toBe(true)
    expect(result.current.isMissing).toBe(false)
    expect(result.current.canInstall).toBe(false)
    expect(result.current.shouldDim).toBe(true)
    await act(async () => resolve([matchedTriggerProvider]))
    await waitFor(() => expect(result.current.isChecking).toBe(false))
    expect(result.current.isMissing).toBe(false)
    expect(result.current.shouldDim).toBe(false)
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

    const matchedRender = renderWorkflowHook(
      () => useNodePluginInstallation(makeDataSourceNode()),
      {
        initialStoreState: {
          dataSourceList: [matchedDataSource],
        },
      },
    )

    expect(matchedRender.result.current.isMissing).toBe(false)
    expect(matchedRender.result.current.shouldDim).toBe(false)
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
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggers.get': (input) => mockTriggerPlugins(input),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': (input) => mockBuiltInTools(input),
      'workspaces.current.tools.api.get': (input) => mockCustomTools(input),
      'workspaces.current.tools.workflow.get': (input) => mockWorkflowTools(input),
      'workspaces.current.tools.mcp.get': (input) => mockMcpTools(input),
    }),
  }
})
