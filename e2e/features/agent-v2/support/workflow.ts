import type { SyncDraftWorkflowPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleClient } from '../../../support/api/console-client'
import * as z from 'zod'

const agentV2WorkflowNodeId = 'agent-v2'
const zWorkflowGraph = z.object({
  nodes: z.array(
    z.object({
      data: z.record(z.string(), z.unknown()).optional(),
      id: z.string(),
    }),
  ),
})

export async function getAgentV2WorkflowNodeData(client: ConsoleClient, appId: string) {
  const draft = await client.apps.byAppId.workflows.draft.get({ params: { app_id: appId } })
  const graph = zWorkflowGraph.parse(draft.graph)
  const agentNode = graph.nodes.find((node) => node.id === agentV2WorkflowNodeId)
  if (!agentNode)
    throw new Error(
      `Workflow draft ${appId} does not include Agent v2 node ${agentV2WorkflowNodeId}.`,
    )

  return agentNode.data ?? {}
}

export async function syncAgentV2WorkflowDraft(
  client: ConsoleClient,
  appId: string,
  agentId: string,
): Promise<void> {
  const body = {
    graph: {
      nodes: [
        {
          id: 'start',
          type: 'custom',
          position: { x: 80, y: 282 },
          data: { id: 'start', type: 'start', title: 'Start', variables: [] },
        },
        {
          id: 'agent-v2',
          type: 'custom',
          position: { x: 420, y: 282 },
          data: {
            id: 'agent-v2',
            type: 'agent',
            title: 'Agent',
            desc: '',
            agent_binding: {
              binding_type: 'roster_agent',
              agent_id: agentId,
            },
            agent_node_kind: 'dify_agent',
            version: '2',
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    features: {},
    environment_variables: [],
    conversation_variables: [],
  } satisfies SyncDraftWorkflowPayload
  await client.apps.byAppId.workflows.draft.post({ body, params: { app_id: appId } })
}
