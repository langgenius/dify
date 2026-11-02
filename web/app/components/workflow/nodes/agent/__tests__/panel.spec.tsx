import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentNodeType } from '../types'
import {
  zAgentProviderResponse,
  zAgentStrategyParameter,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import { VarKindType } from '../../_base/types'
import Panel from '../panel'
import { createProvider, createStrategy } from './strategy-fixture'

// Plugin metadata is an external service; the configuration and strategy owners stay real.
vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: () => ({ isLoading: false, data: { data: { plugins: [] } } }),
  useCheckInstalled: () => ({ data: { plugins: [] } }),
}))

// The strategy picker/form has its own interaction suite; drive its public callbacks here.
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
    type: 'string',
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
  agent_parameters: { instruction: { type: VarKindType.constant, value: 'Plan and answer' } },
  tool_node_version: '2',
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

const renderPanel = (
  data = createData(),
  {
    readOnly = false,
    isChatflow = true,
    features = ['history-messages'] as 'history-messages'[],
  } = {},
) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  for (const [provider, name] of [
    ['provider/agent', 'react'],
    ['provider/updated', 'updated'],
  ]) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.agentProvider.byProviderName.get.queryKey({
        input: { params: { provider_name: provider! } },
      }),
      zAgentProviderResponse.parse(
        createProvider([
          createStrategy({
            identity: {
              author: 'provider',
              name: name!,
              provider: provider!,
              label: { en_US: name! },
            },
            parameters: [createStrategyParam()],
            features,
          }),
        ]),
      ),
    )
  }
  return renderNodePanel(Panel, data, {
    queryClient,
    initialStoreState: { canvasReadOnly: readOnly },
    resource: { kind: 'app', appId: 'app-1', mode: isChatflow ? 'advanced-chat' : 'workflow' },
  })
}

describe('agent/panel', () => {
  it('saves strategy, form and memory updates and exposes output variables', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('summary output')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(screen.getByText('React Agent')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Plan and answer')
    await user.click(screen.getByRole('button', { name: 'change-strategy' }))
    const instruction = screen.getByRole<HTMLInputElement>('textbox', { name: 'Instruction' })
    await user.click(instruction)
    instruction.select()
    await user.paste('Use the tool')
    await user.click(screen.getAllByRole('switch')[1]!)
    expect(data()).toMatchObject({
      agent_strategy_provider_name: 'provider/updated',
      agent_strategy_name: 'updated',
      agent_strategy_label: 'Updated Strategy',
      plugin_unique_identifier: 'provider/updated:1.0.0',
      output_schema: {
        properties: { structured: { type: 'string', description: 'structured output' } },
      },
      agent_parameters: { instruction: { type: VarKindType.constant, value: 'Use the tool' } },
      memory: { window: { enabled: true, size: 3 }, query_prompt_template: '' },
    })
    expect(screen.getByText('Updated Strategy')).toBeInTheDocument()
    expect(screen.getByText('structured output')).toBeInTheDocument()
  })

  it('keeps a saved strategy selected without optional plugin installation metadata', () => {
    renderPanel(createData({ plugin_unique_identifier: undefined }))
    expect(screen.getByText('React Agent')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Plan and answer')
  })

  it('prevents editing memory in readonly mode', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData(), { readOnly: true })
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      await user.click(toggle)
    }
    expect(data().memory).toEqual(createData().memory)
  })

  it.each([
    { isChatflow: false, features: ['history-messages' as const] },
    { isChatflow: true, features: [] },
  ])('hides memory without chat mode or history support ($isChatflow/$features)', (options) => {
    renderPanel(createData(), options)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.common.memory.memory')).not.toBeInTheDocument()
  })
})
