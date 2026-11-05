import type { AgentSoulDifyToolConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { Edge, Node } from '../../../types'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import {
  CANVAS_NODES_STATUS_NAME,
  CanvasNodesCatalogProbe,
} from '../../../__tests__/canvas-nodes-catalog-probe'
import { createEdge, createNode, createStartNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowComponent as render } from '../../../__tests__/workflow-test-env'
import DatasetsDetailProvider from '../../../datasets-detail-store/provider'
import llmDefault from '../../../nodes/llm/default'
import { BlockEnum } from '../../../types'
import WorkflowChecklist from '../index'

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: vi.fn().mockResolvedValue({ data: { list: [] } }),
}))

function createChecklistQueryClient() {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return queryClient
}

function createWarningGraph() {
  const start = createStartNode({
    id: 'start',
    width: 240,
    height: 80,
    data: { variables: [] },
  })
  const missingPlugin = createNode({
    id: 'missing-plugin',
    width: 240,
    height: 80,
    data: {
      type: BlockEnum.Tool,
      title: 'Missing Plugin',
      tool_parameters: {},
      provider_type: CollectionType.builtIn,
      provider_id: 'missing-provider',
      plugin_unique_identifier: 'plugin/tool@0.0.1',
    },
  })
  const invalidNode = createNode({
    id: 'invalid-node',
    width: 240,
    height: 80,
    data: { ...llmDefault.defaultValue, type: BlockEnum.LLM, title: 'Broken Node' },
  })
  return {
    nodes: [start, missingPlugin, invalidNode],
    edges: [
      createEdge({ source: start.id, target: missingPlugin.id }),
      createEdge({ source: start.id, target: invalidNode.id }),
    ],
  }
}

function createInlineAgentGraph() {
  const queryClient = createChecklistQueryClient()
  const nodeId = 'inline-agent'
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
      input: { params: { app_id: 'app-1', node_id: nodeId } },
    }),
    zWorkflowAgentComposerResponse.parse({
      agent_soul: {
        config_files: [],
        config_skills: [],
        tools: { dify_tools: [] satisfies AgentSoulDifyToolConfig[] },
      },
      node_job: {},
      save_options: [],
      soul_lock: { locked: false },
      variant: 'workflow',
    }),
  )
  const start = createStartNode({
    id: 'start',
    width: 240,
    height: 80,
    data: { variables: [] },
  })
  const agent = createNode({
    id: nodeId,
    width: 240,
    height: 80,
    data: {
      type: BlockEnum.AgentV2,
      title: 'Inline Agent',
      agent_node_kind: 'dify_agent',
      version: '2',
      agent_binding: {
        binding_type: 'inline_agent',
        agent_id: 'agent-1',
        current_snapshot_id: 'snapshot-1',
      },
    },
  })
  return {
    nodes: [start, agent],
    edges: [createEdge({ source: start.id, target: agent.id })],
    queryClient,
  }
}

function renderChecklist(
  nodes: Node[],
  edges: Edge[],
  options: {
    disabled?: boolean
    onItemClick?: Parameters<typeof WorkflowChecklist>[0]['onItemClick']
    queryClient?: ReturnType<typeof createChecklistQueryClient>
  } = {},
) {
  return render(
    <DatasetsDetailProvider nodes={nodes}>
      <WorkflowChecklist disabled={options.disabled ?? false} onItemClick={options.onItemClick} />
      <CanvasNodesCatalogProbe />
    </DatasetsDetailProvider>,
    {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      initialStoreState: { nodes },
      nodes,
      edges,
      queryClient: options.queryClient ?? createChecklistQueryClient(),
      reactFlowProps: { fitView: false },
    },
  )
}

function selectedCanvasNodeIds() {
  return (
    screen.getByRole('status', { name: CANVAS_NODES_STATUS_NAME }).textContent?.split(',') ?? []
  ).filter((node) => node.endsWith('*'))
}

describe('WorkflowChecklist', () => {
  it('groups real missing-plugin and invalid-node warnings, then selects the invalid node', async () => {
    const user = userEvent.setup()
    const { nodes, edges } = createWarningGraph()
    renderChecklist(nodes, edges)

    const trigger = await screen.findByRole('button', { name: 'workflow.panel.checklist 2' })
    expect(trigger).toHaveTextContent('2')
    await user.click(trigger)
    expect(screen.getByText(/pluginsNotInstalled/)).toBeInTheDocument()
    expect(screen.getByText('Missing Plugin')).toBeInTheDocument()
    expect(screen.getByText('Broken Node')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /workflow\.errorMsg\.fieldRequired/ }))

    await waitFor(() => expect(selectedCanvasNodeIds()).toEqual(['invalid-node*']))
    expect(
      screen.queryByRole('button', { name: /workflow\.errorMsg\.fieldRequired/ }),
    ).not.toBeInTheDocument()
  })

  it('uses the caller item-click boundary without changing canvas selection', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    const { nodes, edges } = createWarningGraph()
    renderChecklist(nodes, edges, { onItemClick })

    await user.click(await screen.findByRole('button', { name: 'workflow.panel.checklist 2' }))
    await user.click(screen.getByRole('button', { name: /workflow\.errorMsg\.fieldRequired/ }))

    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'invalid-node' }))
    expect(selectedCanvasNodeIds()).toEqual([])
    expect(
      screen.queryByRole('button', { name: /workflow\.errorMsg\.fieldRequired/ }),
    ).not.toBeInTheDocument()
  })

  it('selects an inline agent warning and opens its editor panel', async () => {
    const user = userEvent.setup()
    const { nodes, edges, queryClient } = createInlineAgentGraph()
    const { store } = renderChecklist(nodes, edges, { queryClient })

    await user.click(await screen.findByRole('button', { name: 'workflow.panel.checklist 1' }))
    await user.click(await screen.findByRole('button', { name: /model/i }))

    await waitFor(() => expect(selectedCanvasNodeIds()).toEqual(['inline-agent*']))
    expect(store.getState().openInlineAgentPanelNodeId).toBe('inline-agent')
    expect(screen.queryByRole('button', { name: /model/i })).not.toBeInTheDocument()
  })

  it('renders the resolved state for a valid graph', async () => {
    const user = userEvent.setup()
    const nodes = [
      createStartNode({
        id: 'start',
        width: 240,
        height: 80,
        data: { variables: [] },
      }),
    ]
    renderChecklist(nodes, [])

    await user.click(await screen.findByRole('button', { name: 'workflow.panel.checklist' }))
    expect(screen.getByText(/checklistResolved/i)).toBeInTheDocument()
  })

  it('does not open when disabled', async () => {
    const { nodes, edges } = createWarningGraph()
    renderChecklist(nodes, edges, { disabled: true })

    expect(await screen.findByRole('button', { name: 'workflow.panel.checklist 2' })).toBeDisabled()
    expect(screen.queryByText('Broken Node')).not.toBeInTheDocument()
  })
})
