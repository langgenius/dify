import { CollectionType } from '@/app/components/tools/types'
import { resetReactFlowMockState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useGetToolIcon, useToolIcon } from '../use-tool-icon'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/service/use-tools', async () =>
  (await import('../../__tests__/service-mock-factory')).createToolServiceMock({
    buildInTools: [{ id: 'builtin-1', name: 'builtin', icon: '/builtin.svg', icon_dark: '/builtin-dark.svg', plugin_id: 'p1' }],
    customTools: [{ id: 'custom-1', name: 'custom', icon: '/custom.svg', plugin_id: 'p2' }],
    workflowTools: [{ id: 'workflow-1', name: 'workflow-tool', icon: '/workflow.svg', plugin_id: 'p3' }],
    mcpTools: [{ id: 'mcp-1', name: 'mcp-tool', icon: '/mcp.svg', plugin_id: 'p4' }],
  }))

vi.mock('@/service/use-triggers', async () =>
  (await import('../../__tests__/service-mock-factory')).createTriggerServiceMock({
    triggerPlugins: [{ id: 'trigger-1', icon: '/trigger.svg', icon_dark: '/trigger-dark.svg' }],
  }))

let mockTheme = 'light'
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

vi.mock('@/utils', () => ({
  canFindTool: (id: string, target: string) => id === target,
}))

const baseNodeData = { title: '', desc: '' }

describe('useToolIcon', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    mockTheme = 'light'
  })

  it('should return empty string when no data', () => {
    const { result } = renderWorkflowHook(() => useToolIcon(undefined))
    expect(result.current).toBe('')
  })

  it('should find icon for TriggerPlugin node', () => {
    const data = {
      ...baseNodeData,
      type: BlockEnum.TriggerPlugin,
      plugin_id: 'trigger-1',
      provider_id: 'trigger-1',
      provider_name: 'trigger-1',
    }

    const { result } = renderWorkflowHook(() => useToolIcon(data))
    expect(result.current).toBe('/trigger.svg')
  })

  it('should find icon for Tool node (builtIn)', () => {
    const data = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.builtIn,
      provider_id: 'builtin-1',
      plugin_id: 'p1',
      provider_name: 'builtin',
    }

    const { result } = renderWorkflowHook(() => useToolIcon(data))
    expect(result.current).toBe('/builtin.svg')
  })

  it('should find icon for Tool node (custom)', () => {
    const data = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.custom,
      provider_id: 'custom-1',
      plugin_id: 'p2',
      provider_name: 'custom',
    }

    const { result } = renderWorkflowHook(() => useToolIcon(data))
    expect(result.current).toBe('/custom.svg')
  })

  it('should use dark trigger and provider icons when available', () => {
    mockTheme = 'dark'

    const triggerData = {
      ...baseNodeData,
      type: BlockEnum.TriggerPlugin,
      plugin_id: 'trigger-1',
      provider_id: 'trigger-1',
      provider_name: 'trigger-1',
    }
    const providerFallbackData = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.builtIn,
      provider_id: 'missing-provider',
      provider_name: 'missing',
      provider_icon: '/fallback.svg',
      provider_icon_dark: '/fallback-dark.svg',
    }

    expect(renderWorkflowHook(() => useToolIcon(triggerData)).result.current).toBe('/trigger-dark.svg')
    expect(renderWorkflowHook(() => useToolIcon(providerFallbackData)).result.current).toBe('/fallback-dark.svg')
  })

  it('should resolve workflow, mcp and datasource icons', () => {
    const workflowData = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.workflow,
      provider_id: 'workflow-1',
      provider_name: 'workflow-tool',
    }
    const mcpData = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.mcp,
      provider_id: 'mcp-1',
      provider_name: 'mcp-tool',
    }
    const dataSourceData = {
      ...baseNodeData,
      type: BlockEnum.DataSource,
      plugin_id: 'datasource-1',
    }

    expect(renderWorkflowHook(() => useToolIcon(workflowData)).result.current).toBe('/workflow.svg')
    expect(renderWorkflowHook(() => useToolIcon(mcpData)).result.current).toBe('/mcp.svg')
    expect(renderWorkflowHook(() => useToolIcon(dataSourceData), {
      initialStoreState: {
        dataSourceList: [{ id: 'ds-1', plugin_id: 'datasource-1', icon: '/datasource.svg' }] as never,
      },
    }).result.current).toBe('/datasource.svg')
  })

  it('should fallback to provider_icon when no collection match', () => {
    const data = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.builtIn,
      provider_id: 'unknown-provider',
      plugin_id: 'unknown-plugin',
      provider_name: 'unknown',
      provider_icon: '/fallback.svg',
    }

    const { result } = renderWorkflowHook(() => useToolIcon(data))
    expect(result.current).toBe('/fallback.svg')
  })

  it('should return empty string for unmatched DataSource node', () => {
    const data = {
      ...baseNodeData,
      type: BlockEnum.DataSource,
      plugin_id: 'unknown-ds',
    }

    const { result } = renderWorkflowHook(() => useToolIcon(data))
    expect(result.current).toBe('')
  })

  it('should return empty string for unrecognized node type', () => {
    const data = {
      ...baseNodeData,
      type: BlockEnum.LLM,
    }

    const { result } = renderWorkflowHook(() => useToolIcon(data))
    expect(result.current).toBe('')
  })
})

describe('useGetToolIcon', () => {
  beforeEach(() => {
    resetReactFlowMockState()
  })

  it('should return a function', () => {
    const { result } = renderWorkflowHook(() => useGetToolIcon())
    expect(typeof result.current).toBe('function')
  })

  it('should find icon for TriggerPlugin node via returned function', () => {
    const { result } = renderWorkflowHook(() => useGetToolIcon())

    const data = {
      ...baseNodeData,
      type: BlockEnum.TriggerPlugin,
      plugin_id: 'trigger-1',
      provider_id: 'trigger-1',
      provider_name: 'trigger-1',
    }

    const icon = result.current(data)
    expect(icon).toBe('/trigger.svg')
  })

  it('should find icon for Tool node via returned function', () => {
    const { result } = renderWorkflowHook(() => useGetToolIcon())

    const data = {
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.builtIn,
      provider_id: 'builtin-1',
      plugin_id: 'p1',
      provider_name: 'builtin',
    }

    const icon = result.current(data)
    expect(icon).toBe('/builtin.svg')
  })

  it('should prefer workflow store collections over query collections', () => {
    const { result, store } = renderWorkflowHook(() => useGetToolIcon(), {
      initialStoreState: {
        buildInTools: [{ id: 'override-1', name: 'override', icon: '/override.svg', plugin_id: 'p1' }] as never,
        dataSourceList: [{ id: 'ds-1', plugin_id: 'datasource-1', icon: '/datasource-store.svg' }] as never,
      },
    })

    expect(result.current({
      ...baseNodeData,
      type: BlockEnum.Tool,
      provider_type: CollectionType.builtIn,
      provider_id: 'override-1',
      provider_name: 'override',
    })).toBe('/override.svg')
    expect(result.current({
      ...baseNodeData,
      type: BlockEnum.DataSource,
      plugin_id: 'datasource-1',
    })).toBe('/datasource-store.svg')
    expect(store.getState().buildInTools).toHaveLength(1)
  })

  it('should return undefined for unmatched node type', () => {
    const { result } = renderWorkflowHook(() => useGetToolIcon())

    const data = {
      ...baseNodeData,
      type: BlockEnum.LLM,
    }

    const icon = result.current(data)
    expect(icon).toBeUndefined()
  })
})
