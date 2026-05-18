import type { ReactNode } from 'react'
import type { AgentNodeType } from '../types'
import type useConfig from '../use-config'
import type { StrategyParamItem } from '@/app/components/plugins/types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import { AgentFeature } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockResetEditor = vi.hoisted(() => vi.fn())
const mockAgentStrategy = vi.hoisted(() => vi.fn())
const mockMemoryConfig = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../../../store', () => ({
  useStore: (selector: (state: { setControlPromptEditorRerenderKey: typeof mockResetEditor }) => unknown) => selector({
    setControlPromptEditorRerenderKey: mockResetEditor,
  }),
}))

vi.mock('../../_base/components/agent-strategy', () => ({
  AgentStrategy: (props: {
    strategy?: {
      agent_strategy_provider_name: string
      agent_strategy_name: string
      agent_strategy_label: string
      agent_output_schema: AgentNodeType['output_schema']
      plugin_unique_identifier: string
      meta?: AgentNodeType['meta']
    }
    formSchema: Array<{ variable: string, tooltip?: StrategyParamItem['help'] }>
    formValue: Record<string, unknown>
    onStrategyChange: (strategy: {
      agent_strategy_provider_name: string
      agent_strategy_name: string
      agent_strategy_label: string
      agent_output_schema: AgentNodeType['output_schema']
      plugin_unique_identifier: string
      meta?: AgentNodeType['meta']
    }) => void
    onFormValueChange: (value: Record<string, unknown>) => void
  }) => {
    mockAgentStrategy(props)
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onStrategyChange({
            agent_strategy_provider_name: 'provider/updated',
            agent_strategy_name: 'updated',
            agent_strategy_label: 'Updated Strategy',
            agent_output_schema: {
              properties: {
                structured: {
                  type: 'string',
                  description: 'structured output',
                },
              },
            },
            plugin_unique_identifier: 'provider/updated:1.0.0',
            meta: {
              version: '2.0.0',
            } as AgentNodeType['meta'],
          })}
        >
          change-strategy
        </button>
        <button type="button" onClick={() => props.onFormValueChange({ instruction: 'Use the tool' })}>
          change-form
        </button>
      </div>
    )
  },
}))

vi.mock('../../_base/components/memory-config', () => ({
  __esModule: true,
  default: (props: {
    readonly?: boolean
    config: { data?: AgentNodeType['memory'] }
    onChange: (value?: AgentNodeType['memory']) => void
  }) => {
    mockMemoryConfig(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange({
          window: {
            enabled: true,
            size: 8,
          },
          query_prompt_template: 'history',
        } as AgentNodeType['memory'])}
      >
        change-memory
      </button>
    )
  },
}))

vi.mock('../../_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type, description }: { name: string, type: string, description?: string }) => (
    <div>{`${name}:${type}:${description || ''}`}</div>
  ),
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
    },
  },
  agent_strategy_provider_name: 'provider/agent',
  agent_strategy_name: 'react',
  agent_strategy_label: 'React Agent',
  plugin_unique_identifier: 'provider/agent:1.0.0',
  meta: { version: '1.0.0' } as AgentNodeType['meta'],
  memory: {
    window: {
      enabled: false,
      size: 3,
    },
    query_prompt_template: '',
  } as AgentNodeType['memory'],
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
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
      label: { en_US: 'React Agent' } as StrategyParamItem['label'],
      provider: 'provider/agent',
    },
    parameters: [
      createStrategyParam(),
      createStrategyParam({
        name: 'modelParam',
        type: FormTypeEnum.modelSelector,
        required: false,
      }),
    ],
    description: { en_US: 'agent description' } as StrategyParamItem['label'],
    output_schema: {},
    features: [AgentFeature.HISTORY_MESSAGES],
  },
  formData: {
    instruction: 'Plan and answer',
  },
  onFormChange: vi.fn(),
  currentStrategyStatus: {
    plugin: { source: 'marketplace', installed: true },
    isExistInPlugin: true,
  },
  strategyProvider: undefined,
  pluginDetail: undefined,
  availableVars: [],
  availableNodesWithParent: [],
  outputSchema: [{
    name: 'summary',
    type: 'String',
    description: 'summary output',
  }],
  handleMemoryChange: vi.fn(),
  isChatMode: true,
  ...overrides,
})

const panelProps = {} as NodePanelProps<AgentNodeType>['panelProps']

describe('agent/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('renders strategy data, forwards strategy and form updates, and exposes output vars', async () => {
    const user = userEvent.setup()
    const setInputs = vi.fn()
    const onFormChange = vi.fn()
    const handleMemoryChange = vi.fn()

    mockUseConfig.mockReturnValue(createConfigResult({
      setInputs,
      onFormChange,
      handleMemoryChange,
    }))

    render(
      <Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(screen.getByText('usage:object:workflow.nodes.agent.outputVars.usage')).toBeInTheDocument()
    expect(screen.getByText('files:Array[File]:workflow.nodes.agent.outputVars.files.title')).toBeInTheDocument()
    expect(screen.getByText('json:Array[Object]:workflow.nodes.agent.outputVars.json')).toBeInTheDocument()
    expect(screen.getByText('summary:String:summary output')).toBeInTheDocument()
    expect(mockAgentStrategy).toHaveBeenCalledWith(expect.objectContaining({
      formSchema: expect.arrayContaining([
        expect.objectContaining({
          variable: 'instruction',
          tooltip: { en_US: 'Instruction help' },
        }),
        expect.objectContaining({
          variable: 'modelParam',
        }),
      ]),
      formValue: {
        instruction: 'Plan and answer',
      },
    }))

    await user.click(screen.getByRole('button', { name: 'change-strategy' }))
    await user.click(screen.getByRole('button', { name: 'change-form' }))
    await user.click(screen.getByRole('button', { name: 'change-memory' }))

    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      agent_strategy_provider_name: 'provider/updated',
      agent_strategy_name: 'updated',
      agent_strategy_label: 'Updated Strategy',
      plugin_unique_identifier: 'provider/updated:1.0.0',
      output_schema: expect.objectContaining({
        properties: expect.objectContaining({
          structured: expect.any(Object),
        }),
      }),
    }))
    expect(onFormChange).toHaveBeenCalledWith({ instruction: 'Use the tool' })
    expect(handleMemoryChange).toHaveBeenCalledWith(expect.objectContaining({
      query_prompt_template: 'history',
    }))
    expect(mockResetEditor).toHaveBeenCalledTimes(1)
  })

  it('hides memory config when chat mode support is unavailable', () => {
    mockUseConfig.mockReturnValue(createConfigResult({
      isChatMode: false,
      currentStrategy: {
        ...createConfigResult().currentStrategy!,
        features: [],
      },
    }))

    render(
      <Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByRole('button', { name: 'change-memory' })).not.toBeInTheDocument()
    expect(mockMemoryConfig).not.toHaveBeenCalled()
  })
})
