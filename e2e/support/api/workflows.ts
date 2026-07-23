import type { SyncDraftWorkflowPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleClient } from './console-client'

export async function syncMinimalWorkflowDraft(
  client: ConsoleClient,
  appId: string,
): Promise<void> {
  const body = {
    graph: {
      nodes: [
        {
          id: '1',
          type: 'custom',
          position: { x: 80, y: 282 },
          data: { id: '1', type: 'start', title: 'Start', variables: [] },
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

export async function syncRunnableWorkflowDraft(
  client: ConsoleClient,
  appId: string,
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
          id: 'end',
          type: 'custom',
          position: { x: 480, y: 282 },
          data: {
            id: 'end',
            type: 'end',
            title: 'End',
            outputs: [{ variable: 'result', value_selector: ['sys', 'workflow_run_id'] }],
          },
        },
      ],
      edges: [
        {
          id: 'start-end',
          type: 'custom',
          source: 'start',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    features: {},
    environment_variables: [],
    conversation_variables: [],
  } satisfies SyncDraftWorkflowPayload
  await client.apps.byAppId.workflows.draft.post({ body, params: { app_id: appId } })
}
