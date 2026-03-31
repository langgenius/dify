import type { AgentNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { VarType as ToolVarType } from '../../tool/types'
import useConfig from '../use-config'

const mockSetInputs = vi.fn()
const mockUseNodesReadOnly = vi.fn()
const mockUseNodeCrud = vi.fn()
const mockUseVarList = vi.fn()
const mockUseStrategyProviderDetail = vi.fn()
const mockUseFetchPluginsInMarketPlaceByIds = vi.fn()
const mockUseCheckInstalled = vi.fn()
const mockUseAvailableVarList = vi.fn()
const mockUseIsChatMode = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-var-list', () => ({
  default: (...args: unknown[]) => mockUseVarList(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('@/service/use-strategy', () => ({
  useStrategyProviderDetail: (...args: unknown[]) => mockUseStrategyProviderDetail(...args),
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: (...args: unknown[]) => mockUseFetchPluginsInMarketPlaceByIds(...args),
  useCheckInstalled: (...args: unknown[]) => mockUseCheckInstalled(...args),
}))

const createPayload = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  output_schema: {},
  agent_strategy_provider_name: 'provider/agent',
  agent_strategy_name: 'react',
  agent_strategy_label: 'React Agent',
  agent_parameters: {
    toolParam: {
      type: ToolVarType.constant,
      value: {
        settings: {},
        parameters: {},
        schemas: [],
      },
    },
  },
  ...overrides,
})

const createStrategyProviderDetail = () => ({
  declaration: {
    strategies: [{
      identity: {
        name: 'react',
      },
      parameters: [{
        name: 'toolParam',
        type: FormTypeEnum.toolSelector,
      }],
    }],
  },
})

describe('agent useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: false,
    })
    mockUseNodeCrud.mockImplementation((_id: string, payload: AgentNodeType) => ({
      inputs: payload,
      setInputs: mockSetInputs,
    }))
    mockUseVarList.mockReturnValue({
      handleVarListChange: vi.fn(),
      handleAddVariable: vi.fn(),
    })
    mockUseStrategyProviderDetail.mockReturnValue({
      data: createStrategyProviderDetail(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockUseFetchPluginsInMarketPlaceByIds.mockReturnValue({
      data: {
        data: {
          plugins: [],
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    })
    mockUseCheckInstalled.mockReturnValue({
      data: {
        plugins: [],
      },
    })
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [],
      availableNodesWithParent: [],
    })
    mockUseIsChatMode.mockReturnValue(true)
  })

  it('should skip legacy migration when the node is read-only', () => {
    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: true,
    })

    renderHook(() => useConfig('agent-node', createPayload()))

    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('should migrate legacy agent tool data when the node is editable', () => {
    renderHook(() => useConfig('agent-node', createPayload()))

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      tool_node_version: '2',
    }))
  })
})
