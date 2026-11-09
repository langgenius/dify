import type { SyncDraftWorkflowPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleClient } from './api/console-client.ts'
import * as z from 'zod'

export const templateNodeId = 'e2e-template'

export function createTemplateWorkflowDraft(template: string): SyncDraftWorkflowPayload {
  return {
    graph: {
      nodes: [
        {
          id: 'start',
          type: 'custom',
          position: { x: 40, y: 160 },
          data: { id: 'start', type: 'start', title: 'Start', variables: [] },
        },
        {
          id: templateNodeId,
          type: 'custom',
          position: { x: 360, y: 160 },
          data: {
            id: templateNodeId,
            type: 'template-transform',
            title: 'Format result',
            variables: [],
            template,
          },
        },
        {
          id: 'end',
          type: 'custom',
          position: { x: 680, y: 160 },
          data: {
            id: 'end',
            type: 'end',
            title: 'End',
            outputs: [{ variable: 'result', value_selector: [templateNodeId, 'output'] }],
          },
        },
      ],
      edges: [
        {
          id: 'start-template',
          type: 'custom',
          source: 'start',
          target: templateNodeId,
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'template-end',
          type: 'custom',
          source: templateNodeId,
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
    features: {},
    conversation_variables: [],
  }
}

const zTemplateGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      data: z.object({ template: z.string().optional() }),
    }),
  ),
})

export async function getSavedWorkflowTemplate(client: ConsoleClient, appId: string) {
  const draft = await client.apps.byAppId.workflows.draft.get({ params: { app_id: appId } })
  const node = zTemplateGraph.parse(draft.graph).nodes.find(({ id }) => id === templateNodeId)
  if (!node?.data.template) throw new Error(`Workflow ${appId} has no saved result template.`)
  return node.data.template
}
