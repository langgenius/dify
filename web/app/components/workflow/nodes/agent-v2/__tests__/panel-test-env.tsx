import type { ReactFlowInstance } from 'reactflow'
import type { AgentV2NodeType } from '../types'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { useNodes, useReactFlow } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { AgentV2Panel } from '../panel'

export const createData = (overrides: Partial<AgentV2NodeType> = {}): AgentV2NodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.AgentV2,
  agent_binding: { binding_type: 'roster_agent', agent_id: 'agent-1' },
  agent_node_kind: 'dify_agent',
  version: '2',
  ...overrides,
})

export function createPanelEnvironment({
  data = createData(),
  resource = { kind: 'app', appId: 'app-1', mode: 'workflow' },
}: { data?: AgentV2NodeType; resource?: EditorResource } = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['agent.create'],
    systemFeatures: { rbac_enabled: false },
  })
  seedFeatures(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-1' } } }),
    createAgentFixture({ name: 'Nadia', role: 'Researcher', description: 'Clarification Drafter' }),
  )
  let flow: ReactFlowInstance<AgentV2NodeType>
  const syncDraft = vi.fn(async () => {})
  function NodePanel() {
    flow = useReactFlow<AgentV2NodeType>()
    const node = useNodes<AgentV2NodeType>().find((node) => node.id === 'agent-node')
    return node ? (
      <AgentV2Panel
        id={node.id}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
      />
    ) : null
  }
  const render = createNuqsTestRenderer((ui) =>
    renderWorkflowFlowComponent(<EventEmitterContextProvider>{ui}</EventEmitterContextProvider>, {
      queryClient,
      resource,
      nodes: [
        createNode({
          id: 'source',
          data: { title: 'Source', outputs: { question: { type: 'string' } } },
        }),
        createNode({ id: 'agent-node', data }),
      ],
      edges: [createEdge({ source: 'source', target: 'agent-node' })],
      hooksStoreProps: { doSyncWorkflowDraft: syncDraft },
    }),
  )
  return {
    queryClient,
    syncDraft,
    render: () => render(<NodePanel />),
    getNodeData: () => flow.getNode('agent-node')!.data,
  }
}
