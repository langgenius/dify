import type {
  GetAppsByAppIdWorkflowsDraftResponse,
  PublishWorkflowPayload,
  SyncDraftWorkflowPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import {
  zGetAppsByAppIdWorkflowsDraftResponse,
  zPostAppsByAppIdWorkflowsDraftResponse,
  zPostAppsByAppIdWorkflowsPublishResponse,
} from '@dify/contracts/api/console/apps/zod.gen'
import { createConsoleApiContext, expectApiResponseOK } from './console-context'

export async function getWorkflowDraft(
  appId: string,
): Promise<GetAppsByAppIdWorkflowsDraftResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.get(`/console/api/apps/${appId}/workflows/draft`)
    await expectApiResponseOK(response, `Get workflow draft for ${appId}`)
    return zGetAppsByAppIdWorkflowsDraftResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function syncMinimalWorkflowDraft(appId: string): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const data = {
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
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/draft`, { data })
    await expectApiResponseOK(response, `Sync minimal workflow draft for ${appId}`)
    zPostAppsByAppIdWorkflowsDraftResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function syncRunnableWorkflowDraft(appId: string): Promise<void> {
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
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/draft`, { data })
    await expectApiResponseOK(response, `Sync runnable workflow draft for ${appId}`)
    zPostAppsByAppIdWorkflowsDraftResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function publishWorkflowApp(appId: string): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const data = {
      marked_name: '',
      marked_comment: '',
    } satisfies PublishWorkflowPayload
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/publish`, { data })
    await expectApiResponseOK(response, `Publish workflow app ${appId}`)
    zPostAppsByAppIdWorkflowsPublishResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}
