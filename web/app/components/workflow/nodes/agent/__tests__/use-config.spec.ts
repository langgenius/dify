import type { AgentNodeType } from '../types'
import type { StrategyParamItem } from '@/app/components/plugins/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum, VarType as WorkflowVarType } from '@/app/components/workflow/types'
import { VarType } from '../../tool/types'
import useConfig, { useStrategyInfo } from '../use-config'

const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockUseVarList = vi.hoisted(() => vi.fn())
const mockUseAvailableVarList = vi.hoisted(() => vi.fn())
const mockUseStrategyProviderDetail = vi.hoisted(() => vi.fn())
const mockUseFetchPluginsInMarketPlaceByIds = vi.hoisted(() => vi.fn())
const mockUseCheckInstalled = vi.hoisted(() => vi.fn())
const mockGenerateAgentToolValue = vi.hoisted(() => vi.fn())
const mockToolParametersToFormSchemas = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: (...args: unknown[]) => mockUseNodesReadOnly(...args),
  useIsChatMode: (...args: unknown[]) => mockUseIsChatMode(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseVarList(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('@/service/use-strategy', () => ({
  useStrategyProviderDetail: (...args: unknown[]) => mockUseStrategyProviderDetail(...args),
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: (...args: unknown[]) => mockUseFetchPluginsInMarketPlaceByIds(...args),
  useCheckInstalled: (...args: unknown[]) => mockUseCheckInstalled(...args),
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  generateAgentToolValue: (...args: unknown[]) => mockGenerateAgentToolValue(...args),
  toolParametersToFormSchemas: (...args: unknown[]) => mockToolParametersToFormSchemas(...args),
}))

const createStrategyParam = (overrides: Partial<StrategyParamItem> = {}): StrategyParamItem => ({
  name: 'instruction',
  type: FormTypeEnum.any,
  required: true,
  label: { en_US: 'Instruction' } as StrategyParamItem['label'],
  help: { en_US: 'Instruction help' } as StrategyParamItem['help'],
  placeholder: { en_US: 'Instruction placeholder' } as StrategyParamItem['placeholder'],
  scope: 'global',
  default: null,
  options: [],
  template: { enabled: false },
  auto_generate: { type: 'none' },
  ...overrides,
})

const createToolValue = () => ({
  settings: {
    api_key: 'secret',
  },
  parameters: {
    query: 'weather',
  },
  schemas: [
    {
      variable: 'api_key',
      form: 'form',
    },
    {
      variable: 'query',
      form: 'llm',
    },
  ],
})

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  output_schema: {
    properties: {
      summary: {
        type: 'string',
        description: 'summary output',
      },
      items: {
        type: 'array',
        items: {
          type: 'number',
        },
        description: 'items output',
      },
    },
  },
  agent_strategy_provider_name: 'provider/agent',
  agent_strategy_name: 'react',
  agent_strategy_label: 'React Agent',
  plugin_unique_identifier: 'provider/agent:1.0.0',
  agent_parameters: {
    instruction: {
      type: VarType.variable,
      value: '#start.topic#',
    },
    modelParam: {
      type: VarType.constant,
      value: {
        provider: 'openai',
        model: 'gpt-4o',
      },
    },
  },
  meta: { version: '1.0.0' } as AgentNodeType['meta'],
  ...overrides,
})

describe('agent/use-config', () => {
  const providerRefetch = vi.fn()
  const marketplaceRefetch = vi.fn()
  const setInputs = vi.fn()
  const handleVarListChange = vi.fn()
  const handleAddVariable = vi.fn()
  let currentInputs: AgentNodeType

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createData({
      tool_node_version: '2',
    })

    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseIsChatMode.mockReturnValue(true)
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs,
    }))
    mockUseVarList.mockReturnValue({
      handleVarListChange,
      handleAddVariable,
    } as never)
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{
        nodeId: 'node-1',
        title: 'Start',
        vars: [{
          variable: 'topic',
          type: WorkflowVarType.string,
        }],
      }],
      availableNodesWithParent: [{
        nodeId: 'node-1',
        title: 'Start',
      }],
    } as never)
    mockUseStrategyProviderDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        declaration: {
          strategies: [{
            identity: {
              name: 'react',
            },
            parameters: [
              createStrategyParam(),
              createStrategyParam({
                name: 'modelParam',
                type: FormTypeEnum.modelSelector,
                required: false,
              }),
            ],
          }],
        },
      },
      refetch: providerRefetch,
    } as never)
    mockUseFetchPluginsInMarketPlaceByIds.mockReturnValue({
      isLoading: false,
      data: {
        data: {
          plugins: [{ id: 'provider/agent' }],
        },
      },
      refetch: marketplaceRefetch,
    } as never)
    mockUseCheckInstalled.mockReturnValue({
      data: {
        plugins: [{
          declaration: {
            label: { en_US: 'Installed Agent Plugin' },
          },
        }],
      },
    } as never)
    mockToolParametersToFormSchemas.mockImplementation(value => value as never)
    mockGenerateAgentToolValue.mockImplementation((_value, schemas, isLLM) => ({
      kind: isLLM ? 'llm' : 'setting',
      fields: (schemas as Array<{ variable: string }>).map(item => item.variable),
    }) as never)
  })

  it('returns an undefined strategy status while strategy data is still loading and can refetch dependencies', () => {
    mockUseStrategyProviderDetail.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: providerRefetch,
    } as never)

    const { result } = renderHook(() => useStrategyInfo('provider/agent', 'react'))

    expect(result.current.strategyStatus).toBeUndefined()
    expect(result.current.strategy).toBeUndefined()

    act(() => {
      result.current.refetch()
    })

    expect(providerRefetch).toHaveBeenCalledTimes(1)
    expect(marketplaceRefetch).toHaveBeenCalledTimes(1)
  })

  it('resolves strategy status for external plugins that are missing or not installed', () => {
    mockUseStrategyProviderDetail.mockReturnValue({
      isLoading: false,
      isError: true,
      data: {
        declaration: {
          strategies: [],
        },
      },
      refetch: providerRefetch,
    } as never)
    mockUseFetchPluginsInMarketPlaceByIds.mockReturnValue({
      isLoading: false,
      data: {
        data: {
          plugins: [],
        },
      },
      refetch: marketplaceRefetch,
    } as never)

    const { result } = renderHook(() => useStrategyInfo('provider/agent', 'react'))

    expect(result.current.strategyStatus).toEqual({
      plugin: {
        source: 'external',
        installed: false,
      },
      isExistInPlugin: false,
    })
  })

  it('exposes derived form data, strategy state, output schema, and setter helpers', () => {
    const { result } = renderHook(() => useConfig('agent-node', currentInputs))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.isChatMode).toBe(true)
    expect(result.current.formData).toEqual({
      instruction: '#start.topic#',
      modelParam: {
        provider: 'openai',
        model: 'gpt-4o',
      },
    })
    expect(result.current.currentStrategyStatus).toEqual({
      plugin: {
        source: 'marketplace',
        installed: true,
      },
      isExistInPlugin: true,
    })
    expect(result.current.availableVars).toHaveLength(1)
    expect(result.current.availableNodesWithParent).toEqual([{
      nodeId: 'node-1',
      title: 'Start',
    }])
    expect(result.current.outputSchema).toEqual([
      { name: 'summary', type: 'String', description: 'summary output' },
      { name: 'items', type: 'Array[Number]', description: 'items output' },
    ])

    setInputs.mockClear()

    act(() => {
      result.current.onFormChange({
        instruction: '#start.updated#',
        modelParam: {
          provider: 'anthropic',
          model: 'claude-sonnet',
        },
      })
      result.current.handleMemoryChange({
        window: {
          enabled: true,
          size: 6,
        },
        query_prompt_template: 'history',
      } as AgentNodeType['memory'])
    })

    expect(setInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agent_parameters: {
        instruction: {
          type: VarType.variable,
          value: '#start.updated#',
        },
        modelParam: {
          type: VarType.constant,
          value: {
            provider: 'anthropic',
            model: 'claude-sonnet',
          },
        },
      },
    }))
    expect(setInputs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      memory: {
        window: {
          enabled: true,
          size: 6,
        },
        query_prompt_template: 'history',
      },
    }))
    expect(result.current.handleVarListChange).toBe(handleVarListChange)
    expect(result.current.handleAddVariable).toBe(handleAddVariable)
    expect(result.current.pluginDetail).toEqual({
      declaration: {
        label: { en_US: 'Installed Agent Plugin' },
      },
    })
  })

  it('formats legacy tool selector values before exposing the node config', async () => {
    currentInputs = createData({
      tool_node_version: undefined,
      agent_parameters: {
        toolParam: {
          type: VarType.constant,
          value: createToolValue(),
        },
        multiToolParam: {
          type: VarType.constant,
          value: [createToolValue()],
        },
      },
    })
    mockUseStrategyProviderDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        declaration: {
          strategies: [{
            identity: {
              name: 'react',
            },
            parameters: [
              createStrategyParam({
                name: 'toolParam',
                type: FormTypeEnum.toolSelector,
                required: false,
              }),
              createStrategyParam({
                name: 'multiToolParam',
                type: FormTypeEnum.multiToolSelector,
                required: false,
              }),
            ],
          }],
        },
      },
      refetch: providerRefetch,
    } as never)

    renderHook(() => useConfig('agent-node', currentInputs))

    await waitFor(() => {
      expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
        tool_node_version: '2',
        agent_parameters: expect.objectContaining({
          toolParam: expect.objectContaining({
            value: expect.objectContaining({
              settings: {
                kind: 'setting',
                fields: ['api_key'],
              },
              parameters: {
                kind: 'llm',
                fields: ['query'],
              },
            }),
          }),
          multiToolParam: expect.objectContaining({
            value: [expect.objectContaining({
              settings: {
                kind: 'setting',
                fields: ['api_key'],
              },
              parameters: {
                kind: 'llm',
                fields: ['query'],
              },
            })],
          }),
        }),
      }))
    })
  })
})
