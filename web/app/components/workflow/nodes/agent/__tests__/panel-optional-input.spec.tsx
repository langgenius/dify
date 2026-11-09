import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentNodeType } from '../types'
import { zAgentProviderResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { withSelectorKey } from '@/test/i18n-mock'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import { VarKindType } from '../../_base/types'
import nodeDefault from '../default'
import Panel from '../panel'
import { createProvider, createStrategy } from './strategy-fixture'

// Only external plugin metadata is mocked; the panel, form and variable picker stay real.
vi.mock('@/service/use-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-plugins')>()),
  useFetchPluginsInMarketPlaceByIds: () => ({ isLoading: false, data: { data: { plugins: [] } } }),
  useCheckInstalled: () => ({ data: { plugins: [] } }),
}))

const inputParameter: AgentStrategyParameter = {
  name: 'context',
  type: 'any',
  label: { en_US: 'Context' },
  required: false,
  default: null,
  scope: 'string',
}
const constantParameters: AgentStrategyParameter[] = [
  { name: 'count', type: 'number', label: { en_US: 'Count' }, min: 0, max: 10, default: 0 },
  { name: 'enabled', type: 'boolean', label: { en_US: 'Enabled' }, default: false },
]

function setup(
  agentParameters: AgentNodeType['agent_parameters'],
  parameters: AgentStrategyParameter[] = [inputParameter],
  savedData?: AgentNodeType,
  toolProviders: Parameters<typeof seedToolProviders>[1] = {},
) {
  const strategy = createStrategy({ parameters, features: [] })
  const provider = zAgentProviderResponse.parse(createProvider([strategy]))
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: false },
  })
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
    ...toolProviders,
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [
    provider,
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.agentProvider.byProviderName.get.queryKey({
      input: { params: { provider_name: strategy.identity.provider } },
    }),
    provider,
  )
  const data: AgentNodeType = savedData ?? {
    title: 'Agent',
    desc: '',
    type: BlockEnum.Agent,
    output_schema: null,
    tool_node_version: '2',
    agent_strategy_provider_name: strategy.identity.provider,
    agent_strategy_name: strategy.identity.name,
    agent_strategy_label: 'ReAct',
    plugin_unique_identifier: provider.plugin_unique_identifier ?? undefined,
    agent_parameters: agentParameters,
  }
  const source = createNode({
    id: 'source',
    data: {
      title: 'Source',
      type: BlockEnum.Code,
      outputs: { answer: { type: VarType.string, children: null } },
    },
  })
  const rendered = renderNodePanel(Panel, data, {
    nodeId: 'agent',
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    nodes: [
      createStartNode({ id: 'start', data: { variables: [] } }),
      source,
      createNode({ id: 'agent', data }),
    ],
    edges: [
      createEdge({ source: 'start', target: 'source' }),
      createEdge({ source: 'source', target: 'agent' }),
    ],
  })
  return { ...rendered, strategy, user: userEvent.setup() }
}

it('removes a cleared optional variable while preserving zero, false and unknown saved inputs', async () => {
  const preserved = {
    count: { type: VarKindType.constant, value: 0 },
    enabled: { type: VarKindType.constant, value: false },
    unknown_parameter: { type: VarKindType.constant, value: { count: 0, enabled: false } },
  }
  const parameters = [inputParameter, ...constantParameters]
  const { data, user, unmount } = setup(
    {
      ...preserved,
      context: { type: VarKindType.variable, value: ['source', 'answer'] },
    },
    parameters,
  )
  expect(screen.getByText('answer')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Count' })).toHaveValue('0')
  expect(screen.getByRole('radio', { name: 'False' })).toBeChecked()

  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  await user.keyboard('{Escape}')

  expect(screen.queryByText('answer')).not.toBeInTheDocument()

  // Reopen from serialized graph data; this does not simulate backend persistence.
  const savedData: AgentNodeType = JSON.parse(JSON.stringify(data()))
  unmount()
  const reopened = setup(savedData.agent_parameters, parameters, savedData)
  expect(screen.queryByText('answer')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.clear' })).not.toBeInTheDocument()
  expect(reopened.data().agent_parameters).toEqual(savedData.agent_parameters)
  expect(savedData.agent_parameters).toMatchObject(preserved)
  expect(savedData.agent_parameters).toEqual(preserved)
  expect(reopened.data().agent_parameters).toEqual(preserved)

  await reopened.user.click(screen.getByRole('radio', { name: 'True' }))
  expect(reopened.data().agent_parameters).toEqual({
    ...preserved,
    enabled: { type: VarKindType.constant, value: true },
  })
})

it('does not save an unconfigured optional variable when another form field changes', async () => {
  const { data, user } = setup(
    {
      count: { type: VarKindType.constant, value: 0 },
      enabled: { type: VarKindType.constant, value: true },
    },
    [inputParameter, ...constantParameters],
  )

  await user.click(screen.getByRole('radio', { name: 'False' }))

  await waitFor(() =>
    expect(data().agent_parameters).toEqual({
      count: { type: VarKindType.constant, value: 0 },
      enabled: { type: VarKindType.constant, value: false },
    }),
  )
})

it('can select a variable again after clearing it through the form', async () => {
  const { data, user } = setup({
    context: { type: VarKindType.variable, value: ['source', 'answer'] },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  // The real clear action also opens the containing variable picker.
  const picker = await screen.findByRole('dialog')
  await user.type(within(picker).getByRole('searchbox'), 'answer')
  await user.click(within(picker).getByText('answer'))

  await waitFor(() =>
    expect(data().agent_parameters).toEqual({
      context: { type: VarKindType.variable, value: ['source', 'answer'] },
    }),
  )
})

it('keeps a cleared required variable subject to required-field validation', async () => {
  const { data, strategy, user } = setup(
    {
      context: { type: VarKindType.variable, value: ['source', 'answer'] },
    },
    [{ ...inputParameter, required: true }],
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

  const validation = nodeDefault.checkValid(
    data(),
    withSelectorKey((key: string) => key, 'workflow'),
    {
      strategy,
      language: 'en_US',
      isReadyForCheckValid: true,
    },
  )
  expect(validation.isValid).toBe(false)
  expect(data().agent_parameters?.context).toEqual({ type: VarKindType.variable, value: '' })
})

it('omits a saved empty variable selector without changing tool arrays or nested automatic inputs', async () => {
  const tool = {
    provider_name: 'regular',
    tool_name: 'search',
    tool_label: 'Search',
    enabled: true,
    settings: {},
    parameters: { query: { auto: 1, value: null } },
  }
  const preserved = {
    count: { type: VarKindType.constant, value: 0 },
    empty_tools: { type: VarKindType.constant, value: [] },
    tools: { type: VarKindType.constant, value: [tool] },
    unknown_variable: { type: VarKindType.variable, value: [] },
  }
  const { data, user } = setup(
    {
      ...preserved,
      enabled: { type: VarKindType.constant, value: true },
      context: { type: VarKindType.variable, value: [] },
    },
    [
      inputParameter,
      ...constantParameters,
      {
        name: 'empty_tools',
        type: 'array[tools]',
        label: { en_US: 'Empty tools' },
        required: false,
      },
      { name: 'tools', type: 'array[tools]', label: { en_US: 'Tools' }, required: false },
    ],
    undefined,
    {
      builtInTools: [
        createToolProviderFixture({
          id: 'regular',
          name: 'regular',
          is_team_authorization: true,
          tools: [
            {
              name: 'search',
              author: 'Dify',
              label: { en_US: 'Search' },
              description: { en_US: 'Search records' },
              parameters: [
                { name: 'query', type: 'string', form: 'llm', label: { en_US: 'Query' } },
              ],
            },
          ],
        }),
      ],
    },
  )
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()

  await user.click(screen.getByRole('radio', { name: 'False' }))

  expect(data().agent_parameters).toEqual({
    ...preserved,
    enabled: { type: VarKindType.constant, value: false },
  })
})

it('preserves a nonempty selector for a missing upstream node when another field changes', async () => {
  const context = { type: VarKindType.variable, value: ['missing-node', 'answer'] }
  const { data, user } = setup(
    {
      context,
      enabled: { type: VarKindType.constant, value: true },
    },
    [inputParameter, constantParameters[1]!],
  )

  await user.click(screen.getByRole('radio', { name: 'False' }))

  expect(data().agent_parameters).toEqual({
    context,
    enabled: { type: VarKindType.constant, value: false },
  })
})
