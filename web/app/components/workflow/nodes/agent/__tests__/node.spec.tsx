import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { AgentNodeType } from '../types'
import type useConfig from '../use-config'
import { zAgentStrategyParameter } from '@dify/contracts/api/console/workspaces/zod.gen'
import { render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockModelBar = vi.hoisted(() => vi.fn())
const mockToolIcon = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: string | { en_US?: string }) =>
    typeof value === 'string' ? value : value.en_US || '',
}))

vi.mock('../components/model-bar', () => ({
  ModelBar: (props: { provider?: string; model?: string; param: string }) => {
    mockModelBar(props)
    return (
      <div>
        {props.provider
          ? `${props.param}:${props.provider}/${props.model}`
          : `${props.param}:empty-model`}
      </div>
    )
  },
}))

vi.mock('../components/tool-icon', () => ({
  ToolIcon: (props: { providerName: string }) => {
    mockToolIcon(props)
    return <div>{`tool:${props.providerName}`}</div>
  },
}))

vi.mock('../../_base/components/group', () => ({
  Group: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <div>
      <div>{label}</div>
      {children}
    </div>
  ),
  GroupLabel: ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('../../_base/components/setting-item', () => ({
  SettingItem: ({
    label,
    status,
    tooltip,
    children,
  }: {
    label: ReactNode
    status?: string
    tooltip?: string
    children?: ReactNode
  }) => (
    <div>
      {`${label}:${status || 'normal'}:${tooltip || ''}`}
      {children}
    </div>
  ),
}))

const createStrategyParam = (overrides: Partial<AgentStrategyParameter> = {}) =>
  zAgentStrategyParameter.parse({
    name: 'requiredModel',
    type: FormTypeEnum.modelSelector,
    required: true,
    label: { en_US: 'Required Model' },
    help: { en_US: 'Required model help' },
    placeholder: { en_US: 'Required model placeholder' },
    scope: 'global',
    default: null,
    options: [],
    template: { enabled: false },
    auto_generate: null,
    ...overrides,
  })

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  output_schema: {},
  agent_strategy_provider_name: 'provider/agent',
  agent_strategy_name: 'react',
  agent_strategy_label: 'React Agent',
  plugin_unique_identifier: 'provider/agent:1.0.0',
  agent_parameters: {
    optionalModel: {
      type: VarKindType.constant,
      value: { provider: 'openai', model: 'gpt-4o' },
    },
    toolParam: {
      type: VarKindType.constant,
      value: { provider_name: 'author/tool-a' },
    },
    multiToolParam: {
      type: VarKindType.constant,
      value: [{ provider_name: 'author/tool-b' }, { provider_name: 'author/tool-c' }],
    },
  },
  ...overrides,
})

const createConfigResult = (
  overrides: Partial<ReturnType<typeof useConfig>> = {},
): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  setInputs: vi.fn(),
  handleVarListChange: vi.fn(),
  handleAddVariable: vi.fn(),
  currentStrategy: {
    identity: {
      author: 'provider',
      name: 'react',
      icon: 'icon',
      label: { en_US: 'React Agent' },
      provider: 'provider/agent',
    },
    parameters: [
      createStrategyParam(),
      createStrategyParam({
        name: 'optionalModel',
        required: false,
      }),
      createStrategyParam({
        name: 'multiToolParam',
        type: FormTypeEnum.multiToolSelector,
        required: false,
      }),
    ],
    description: { en_US: 'agent description' },
    output_schema: {},
    features: [],
  },
  formData: {},
  onFormChange: vi.fn(),
  currentStrategyStatus: {
    plugin: { source: 'marketplace', installed: true },
    isExistInPlugin: false,
  },
  strategyProvider: undefined,
  pluginDetail: {
    declaration: {
      label: { en_US: 'Plugin Marketplace' } as never,
    },
  } as never,
  availableVars: [],
  availableNodesWithParent: [],
  outputSchema: [],
  handleMemoryChange: vi.fn(),
  isChatMode: true,
  ...overrides,
})

describe('agent/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('renders the not-set state when no strategy is configured', () => {
    mockUseConfig.mockReturnValue(
      createConfigResult({
        inputs: createData({
          agent_strategy_name: undefined,
          agent_strategy_label: undefined,
          agent_parameters: {},
        }),
        currentStrategy: undefined,
      }),
    )

    render(<Node id="agent-node" data={createData()} />)

    expect(screen.getByText('workflow.nodes.agent.strategyNotSet:normal:')).toBeInTheDocument()
    expect(mockModelBar).not.toHaveBeenCalled()
    expect(mockToolIcon).not.toHaveBeenCalled()
  })

  it('renders strategy status, required and selected model bars, and tool icons', () => {
    render(<Node id="agent-node" data={createData()} />)

    expect(screen.getByText(/workflow.nodes.agent.strategy.shortLabel:error:/)).toHaveTextContent(
      'React Agent',
    )
    expect(screen.getByText(/workflow.nodes.agent.strategy.shortLabel:error:/)).toHaveTextContent(
      'Plugin Marketplace',
    )
    expect(screen.getByText('requiredModel:empty-model')).toBeInTheDocument()
    expect(screen.getByText('optionalModel:openai/gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('tool:author/tool-b')).toBeInTheDocument()
    expect(screen.getByText('tool:author/tool-c')).toBeInTheDocument()
    expect(mockModelBar).toHaveBeenCalledTimes(2)
    expect(mockToolIcon).toHaveBeenCalledTimes(2)
  })

  it('skips optional models and empty tool values when no configuration is provided', () => {
    mockUseConfig.mockReturnValue(
      createConfigResult({
        inputs: createData({
          agent_parameters: {},
        }),
        currentStrategy: {
          ...createConfigResult().currentStrategy!,
          parameters: [
            createStrategyParam({
              name: 'optionalModel',
              required: false,
            }),
          ],
        },
        currentStrategyStatus: {
          plugin: { source: 'marketplace', installed: true },
          isExistInPlugin: true,
        },
      }),
    )

    render(<Node id="agent-node" data={createData()} />)

    expect(mockModelBar).not.toHaveBeenCalled()
    expect(mockToolIcon).not.toHaveBeenCalled()
    expect(screen.queryByText('optionalModel:empty-model')).not.toBeInTheDocument()
  })
})
