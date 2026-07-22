import type { SyncDraftWorkflowPayload } from '@dify/contracts/api/console/apps/types.gen'
import { zPostAppsByAppIdWorkflowsDraftResponse } from '@dify/contracts/api/console/apps/zod.gen'
import * as z from 'zod'
import { createConsoleApiContext, expectApiResponseOK } from '../../../support/api/console-context'
import { getWorkflowDraft } from '../../../support/api/workflows'

const agentV2WorkflowNodeId = 'agent-v2'
const zWorkflowGraph = z.object({
  nodes: z.array(
    z.object({
      data: z.record(z.string(), z.unknown()).optional(),
      id: z.string(),
    }),
  ),
})

export async function getAgentV2WorkflowNodeData(appId: string) {
  const draft = await getWorkflowDraft(appId)
  const graph = zWorkflowGraph.parse(draft.graph)
  const agentNode = graph.nodes.find((node) => node.id === agentV2WorkflowNodeId)
  if (!agentNode)
    throw new Error(
      `Workflow draft ${appId} does not include Agent v2 node ${agentV2WorkflowNodeId}.`,
    )

  return agentNode.data ?? {}
}

export async function syncAgentV2WorkflowDraft(appId: string, agentId: string): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const data = {
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
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/draft`, { data })
    await expectApiResponseOK(response, `Sync Agent v2 workflow draft for ${appId}`)
    zPostAppsByAppIdWorkflowsDraftResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}
