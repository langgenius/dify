import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentNodeType } from '../types'
import type useConfig from '../use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { zAgentStrategyParameter } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const mockUseConfig = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../../_base/components/agent-strategy', () => ({
  AgentStrategy: (props: {
    strategy?: {
      agent_strategy_provider_name: string
      agent_strategy_name: string
      agent_strategy_label: string
      agent_output_schema: AgentNodeType['output_schema']
      plugin_unique_identifier?: string
      meta?: AgentNodeType['meta']
    }
    formSchema: AgentStrategyParameter[]
    formValue: Record<string, unknown>
    onStrategyChange: (strategy: {
      agent_strategy_provider_name: string
      agent_strategy_name: string
      agent_strategy_label: string
      agent_output_schema: AgentNodeType['output_schema']
      plugin_unique_identifier?: string
      meta?: AgentNodeType['meta']
    }) => void
    onFormValueChange: (value: Record<string, unknown>) => void
  }) => {
    return (
      <div>
        <span>{props.strategy?.agent_strategy_label}</span>
        <input
          aria-label="Instruction"
          value={String(props.formValue.instruction || '')}
          onChange={(event) => props.onFormValueChange({ instruction: event.target.value })}
        />
        <button
          type="button"
          onClick={() =>
            props.onStrategyChange({
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
            })
          }
        >
          change-strategy
        </button>
      </div>
    )
  },
}))

const createStrategyParam = (overrides: Partial<AgentStrategyParameter> = {}) =>
  zAgentStrategyParameter.parse({
    name: 'instruction',
    type: FormTypeEnum.any,
    required: true,
    label: { en_US: 'Instruction' },
    help: { en_US: 'Instruction help' },
    placeholder: { en_US: 'Instruction placeholder' },
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
        name: 'modelParam',
        type: FormTypeEnum.modelSelector,
        required: false,
      }),
    ],
    description: { en_US: 'agent description' },
    output_schema: {},
    features: ['history-messages' as const],
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
  outputSchema: [
    {
      name: 'summary',
      type: 'String',
      description: 'summary output',
    },
  ],
  handleMemoryChange: vi.fn(),
  isChatflow: true,
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

    mockUseConfig.mockReturnValue(
      createConfigResult({
        setInputs,
        onFormChange,
        handleMemoryChange,
      }),
    )

    render(<Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    await user.click(screen.getByText('workflow.nodes.common.outputVars'))
    expect(screen.getByText('summary output')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(screen.getByText('React Agent')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Plan and answer')

    await user.click(screen.getByRole('button', { name: 'change-strategy' }))
    const instruction = screen.getByRole('textbox', { name: 'Instruction' }) as HTMLInputElement
    await user.click(instruction)
    instruction.select()
    await user.paste('Use the tool')
    await user.click(screen.getAllByRole('switch')[1]!)

    expect(setInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_strategy_provider_name: 'provider/updated',
        agent_strategy_name: 'updated',
        agent_strategy_label: 'Updated Strategy',
        plugin_unique_identifier: 'provider/updated:1.0.0',
        output_schema: expect.objectContaining({
          properties: expect.objectContaining({
            structured: expect.any(Object),
          }),
        }),
      }),
    )
    expect(onFormChange).toHaveBeenCalledWith({ instruction: 'Use the tool' })
    expect(handleMemoryChange).toHaveBeenCalledWith(
      expect.objectContaining({
        window: { enabled: true, size: 3 },
        query_prompt_template: '',
      }),
    )
  })

  it('keeps a saved strategy selected without optional plugin installation metadata', () => {
    const inputs = createData({ plugin_unique_identifier: undefined })
    mockUseConfig.mockReturnValue(createConfigResult({ inputs }))
    render(<Panel id="agent-node" data={inputs} panelProps={panelProps} />)
    expect(screen.getByText('React Agent')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Plan and answer')
  })

  it('prevents editing memory in readonly mode', async () => {
    const user = userEvent.setup()
    const handleMemoryChange = vi.fn()
    mockUseConfig.mockReturnValue(createConfigResult({ readOnly: true, handleMemoryChange }))
    render(<Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      await user.click(toggle)
    }
    expect(handleMemoryChange).not.toHaveBeenCalled()
  })

  it.each([
    { isChatflow: false, features: ['history-messages' as const] },
    { isChatflow: true, features: [] },
  ])(
    'hides memory without chat mode or history support ($isChatflow/$features)',
    ({ isChatflow, features }) => {
      mockUseConfig.mockReturnValue(
        createConfigResult({
          isChatflow,
          currentStrategy: {
            ...createConfigResult().currentStrategy!,
            features,
          },
        }),
      )

      render(<Panel id="agent-node" data={createData()} panelProps={panelProps} />)

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.common.memory.memory')).not.toBeInTheDocument()
    },
  )
})
