import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { APIResponse } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { zAppDetailWithSite } from '@dify/contracts/api/console/apps/zod.gen'
import { request } from '@playwright/test'
import { authStatePath } from '../fixtures/auth'
import { apiURL } from '../test-env'
import { assertE2EResourceName, createE2EResourceName } from './naming'

type StorageState = {
  cookies: Array<{ name: string; value: string }>
}

export async function createApiContext() {
  const state = JSON.parse(await readFile(authStatePath, 'utf8')) as StorageState
  const csrfToken = state.cookies.find((c) => c.name.endsWith('csrf_token'))?.value ?? ''

  return request.newContext({
    baseURL: apiURL,
    extraHTTPHeaders: { 'X-CSRF-Token': csrfToken },
    storageState: authStatePath,
  })
}

export async function expectApiResponseOK(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) return

  const body = await response.text().catch(() => '')
  throw new Error(`${action} failed with ${response.status()} ${response.statusText()}: ${body}`)
}

export type AppSeed = {
  id: string
  name: string
}

export type WorkflowDraft = {
  graph: {
    edges: Array<Record<string, unknown>>
    nodes: Array<{
      data?: Record<string, unknown>
      id: string
      type: string
    }>
    viewport?: Record<string, unknown>
  }
}

export async function createTestApp(
  name = createE2EResourceName('App'),
  mode = 'workflow',
): Promise<AppSeed> {
  assertE2EResourceName(name, 'App')
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/apps', {
      data: {
        name,
        mode,
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#FFEAD5',
      },
    })
    await expectApiResponseOK(response, `Create ${mode} app ${name}`)
    const body = (await response.json()) as AppSeed
    return body
  } finally {
    await ctx.dispose()
  }
}

export async function getWorkflowDraft(appId: string): Promise<WorkflowDraft> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/apps/${appId}/workflows/draft`)
    await expectApiResponseOK(response, `Get workflow draft for ${appId}`)
    return (await response.json()) as WorkflowDraft
  } finally {
    await ctx.dispose()
  }
}

export async function syncMinimalWorkflowDraft(appId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/draft`, {
      data: {
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
      },
    })
    await expectApiResponseOK(response, `Sync minimal workflow draft for ${appId}`)
  } finally {
    await ctx.dispose()
  }
}

export async function syncAgentV2WorkflowDraft(appId: string, agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/draft`, {
      data: {
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
      },
    })
    await expectApiResponseOK(response, `Sync Agent v2 workflow draft for ${appId}`)
  } finally {
    await ctx.dispose()
  }
}

export async function deleteTestApp(id: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/apps/${id}`)
    await expectApiResponseOK(response, `Delete app ${id}`)
  } finally {
    await ctx.dispose()
  }
}

export async function syncRunnableWorkflowDraft(appId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/draft`, {
      data: {
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
      },
    })
    await expectApiResponseOK(response, `Sync runnable workflow draft for ${appId}`)
  } finally {
    await ctx.dispose()
  }
}

export async function publishWorkflowApp(appId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/apps/${appId}/workflows/publish`, {
      data: { marked_name: '', marked_comment: '' },
    })
    await expectApiResponseOK(response, `Publish workflow app ${appId}`)
  } finally {
    await ctx.dispose()
  }
}

export function getAppSiteURL({ mode, site }: AppDetailWithSite): string {
  if (!site?.app_base_url || !site.access_token)
    throw new Error('App detail does not include a Web App URL.')

  const webAppMode = (() => {
    if (mode === 'completion' || mode === 'workflow') return mode
    if (mode === 'advanced-chat' || mode === 'agent-chat' || mode === 'chat') return 'chat'
    throw new Error(`Unsupported Web App mode: ${mode}`)
  })()

  return `${site.app_base_url}/${webAppMode}/${site.access_token}`
}

export async function getAppSiteDetail(appId: string): Promise<AppDetailWithSite> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/apps/${appId}`)
    await expectApiResponseOK(response, `Get app site detail for ${appId}`)
    return zAppDetailWithSite.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function enableAppSiteAndGetURL(appId: string): Promise<string> {
  return getAppSiteURL(await setAppSiteEnabled(appId, true))
}

export async function setAppSiteEnabled(
  appId: string,
  enabled: boolean,
): Promise<AppDetailWithSite> {
  const ctx = await createApiContext()
  try {
    const enableResponse = await ctx.post(`/console/api/apps/${appId}/site-enable`, {
      data: { enable_site: enabled },
    })
    await expectApiResponseOK(enableResponse, `${enabled ? 'Enable' : 'Disable'} app site ${appId}`)
  } finally {
    await ctx.dispose()
  }

  return getAppSiteDetail(appId)
}
