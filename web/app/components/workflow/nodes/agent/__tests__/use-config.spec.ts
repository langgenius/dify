import type { AgentNodeType } from '../types'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import useConfig, { useStrategyInfo } from '../use-config'
import { createProvider, createStrategy } from './strategy-fixture'

const { request, setInputs, marketplaceRefetch, marketplaceQuery } = vi.hoisted(() => ({
  request: vi.fn(),
  setInputs: vi.fn(),
  marketplaceRefetch: vi.fn(),
  marketplaceQuery: vi.fn(),
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useIsChatMode: () => true,
}))
vi.mock('../../_base/hooks/use-node-crud', () => ({
  default: (_id: string, inputs: AgentNodeType) => ({ inputs, setInputs }),
}))
vi.mock('../../_base/hooks/use-var-list', () => ({
  default: () => ({ handleVarListChange: vi.fn(), handleAddVariable: vi.fn() }),
}))
vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))
vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: marketplaceQuery,
  useCheckInstalled: () => ({ data: { plugins: [] } }),
}))

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  output_schema: null,
  agent_strategy_provider_name: 'langgenius/agent/provider',
  agent_strategy_name: 'react',
  agent_parameters: { instruction: { type: VarKindType.constant, value: '' } },
  tool_node_version: '2',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  request.mockImplementation(() => Promise.resolve(Response.json(createProvider())))
  marketplaceRefetch.mockResolvedValue({ data: undefined })
  marketplaceQuery.mockReturnValue({
    isLoading: false,
    data: { data: { plugins: [] } },
    refetch: marketplaceRefetch,
  })
})

describe('agent strategy query and configuration', () => {
  it('does not request or refetch a missing provider', () => {
    const { result } = renderHook(() => useStrategyInfo())
    expect(result.current.strategyStatus).toBeUndefined()
    act(() => result.current.refetch())
    expect(request).not.toHaveBeenCalled()
    expect(marketplaceRefetch).not.toHaveBeenCalled()
    expect(marketplaceQuery).toHaveBeenCalledWith([], { retry: false })
  })

  it('treats a failed provider lookup as missing without retrying', async () => {
    request.mockImplementation(() =>
      Promise.resolve(Response.json({ message: 'Missing provider' }, { status: 404 })),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 2, retryDelay: 0 } },
    })
    const { result } = renderHook(() => useStrategyInfo('langgenius/agent/missing', 'react'), {
      queryClient,
    })
    await waitFor(() => expect(result.current.strategyProvider.isError).toBe(true))
    expect(result.current.strategyStatus).toEqual({
      plugin: { source: 'external', installed: false },
      isExistInPlugin: false,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps cleared form values and unknown persisted parameters when editing', async () => {
    const inputs = createData({
      agent_parameters: {
        instruction: { type: VarKindType.constant, value: '' },
        unknown_parameter: { type: VarKindType.constant, value: { count: 0, enabled: false } },
      },
    })
    const { result } = renderHook(() => useConfig('agent', inputs))
    await waitFor(() => expect(result.current.currentStrategy?.identity.name).toBe('react'))
    expect(result.current.formData).toEqual({ instruction: '' })
    expect(result.current.outputSchema).toEqual([])
    expect(result.current.currentStrategyStatus?.plugin.installed).toBe(true)
    act(() => result.current.onFormChange({ instruction: 'Changed' }))
    expect(setInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agent_parameters: {
          instruction: { type: VarKindType.constant, value: 'Changed' },
          unknown_parameter: { type: VarKindType.constant, value: { count: 0, enabled: false } },
        },
      }),
    )
  })

  it('converts legacy arrays of tools once and preserves unknown persisted values', async () => {
    const provider = createProvider([
      createStrategy({
        parameters: [{ name: 'tools', type: 'array[tools]', label: { en_US: 'Tools' } }],
      }),
    ])
    request.mockImplementation(() => Promise.resolve(Response.json(provider)))
    const legacyTool = {
      provider_name: 'langgenius/weather/provider',
      tool_name: 'weather',
      tool_label: 'Weather',
      enabled: true,
      settings: { api_key: { value: 'secret' } },
      parameters: { query: { value: 'weather', auto: 0 } },
      schemas: [
        {
          name: 'api_key',
          type: 'secret-input',
          form: 'form',
          label: { en_US: 'API key', zh_Hans: 'API key' },
        },
        { name: 'query', type: 'string', form: 'llm', label: { en_US: 'Query', zh_Hans: 'Query' } },
      ],
    }
    const inputs = createData({
      tool_node_version: undefined,
      agent_parameters: {
        tools: { type: VarKindType.constant, value: [legacyTool] },
        unrecognized: { type: VarKindType.constant, value: { untouched: true } },
      },
    })
    renderHook(() => useConfig('agent', inputs))
    await waitFor(() =>
      expect(setInputs).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_node_version: '2',
          agent_parameters: {
            tools: {
              type: VarKindType.constant,
              value: [
                expect.objectContaining({
                  settings: { api_key: { value: { type: 'mixed', value: 'secret' } } },
                  parameters: { query: { auto: 0, value: 'weather' } },
                }),
              ],
            },
            unrecognized: { type: VarKindType.constant, value: { untouched: true } },
          },
        }),
      ),
    )
    expect(inputs.agent_parameters?.tools?.value).toEqual([legacyTool])
  })

  it('keeps JSON Schema boolean outputs and displays unknown or empty types', () => {
    const { result } = renderHook(() =>
      useConfig(
        'agent',
        createData({
          output_schema: {
            properties: {
              allowed: true,
              forbidden: false,
              empty: { type: '' },
              array: { type: 'array', items: { type: '' } },
            },
          },
        }),
      ),
    )
    expect(result.current.outputSchema).toEqual([
      { name: 'allowed', type: 'Unknown', description: '' },
      { name: 'forbidden', type: 'Unknown', description: '' },
      { name: 'empty', type: 'Unknown', description: '' },
      { name: 'array', type: 'Array[Unknown]', description: '' },
    ])
  })

  it('does not convert tools with an existing tool node version', async () => {
    const inputs = createData({
      agent_parameters: {
        tools: {
          type: VarKindType.constant,
          value: [{ settings: { secret: { value: 'existing' } } }],
        },
      },
    })
    renderHook(() => useConfig('agent', inputs))
    await waitFor(() => expect(setInputs).toHaveBeenCalledWith(inputs))
  })
})
