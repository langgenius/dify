import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentNodeType } from '../types'
import {
  zAgentProviderResponse,
  zAgentStrategyParameter,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import Node from '../node'
import { createProvider, createStrategy } from './strategy-fixture'

// Plugin installation metadata is external; strategy resolution and node configuration stay real.
vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: () => ({ isLoading: false, data: { data: { plugins: [] } } }),
  useCheckInstalled: () => ({ data: { plugins: [] } }),
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
  tool_node_version: '2',
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

function renderNode(
  data: AgentNodeType,
  parameters = [
    createStrategyParam(),
    createStrategyParam({ name: 'optionalModel', required: false }),
    createStrategyParam({
      name: 'multiToolParam',
      type: FormTypeEnum.multiToolSelector,
      required: false,
    }),
  ],
) {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.agentProvider.byProviderName.get.queryKey({
      input: { params: { provider_name: 'provider/agent' } },
    }),
    zAgentProviderResponse.parse(createProvider([createStrategy({ parameters })])),
  )
  return renderWorkflowFlowComponent(
    <NuqsTestingAdapter>
      <Node id="agent-node" data={data} />
    </NuqsTestingAdapter>,
    {
      queryClient,
      nodes: [createNode({ id: 'agent-node', data })],
    },
  )
}

describe('agent/node', () => {
  it('renders the not-set state when no strategy is configured', () => {
    renderNode(
      createData({
        agent_strategy_name: undefined,
        agent_strategy_label: undefined,
        agent_parameters: {},
      }),
    )
    expect(screen.getByText('workflowAgent.nodes.agent.strategyNotSet')).toBeInTheDocument()
    expect(screen.queryByText('workflowAgent.nodes.agent.model')).not.toBeInTheDocument()
    expect(screen.queryByText('workflowAgent.nodes.agent.toolbox')).not.toBeInTheDocument()
  })

  it('renders required and selected models and the configured tools from the resolved strategy', () => {
    renderNode(createData())
    expect(screen.getByText('React Agent')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.modelNotSelected')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('workflowAgent.nodes.agent.toolbox')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'tool icon' })).toHaveLength(2)
  })

  it('omits unconfigured optional models and tools', () => {
    renderNode(createData({ agent_parameters: {} }), [
      createStrategyParam({ name: 'optionalModel', required: false }),
    ])
    expect(screen.getByText('React Agent')).toBeInTheDocument()
    expect(screen.queryByText('workflowAgent.nodes.agent.model')).not.toBeInTheDocument()
    expect(screen.queryByText('workflowAgent.nodes.agent.toolbox')).not.toBeInTheDocument()
  })
})
