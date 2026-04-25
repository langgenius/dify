import { readFile } from 'node:fs/promises'
import { request } from '@playwright/test'
import { authStatePath } from '../fixtures/auth'
import { apiURL } from '../test-env'

type StorageState = {
  cookies: Array<{ name: string, value: string }>
}

async function createApiContext() {
  const state = JSON.parse(await readFile(authStatePath, 'utf8')) as StorageState
  const csrfToken = state.cookies.find(c => c.name.endsWith('csrf_token'))?.value ?? ''

  return request.newContext({
    baseURL: apiURL,
    extraHTTPHeaders: { 'X-CSRF-Token': csrfToken },
    storageState: authStatePath,
  })
}

export type AppSeed = {
  id: string
  name: string
}

export async function createTestApp(name: string, mode = 'workflow'): Promise<AppSeed> {
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
    const body = (await response.json()) as AppSeed
    return body
  }
  finally {
    await ctx.dispose()
  }
}

export async function syncMinimalWorkflowDraft(appId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    await ctx.post(`/console/api/apps/${appId}/workflows/draft`, {
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
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteTestApp(id: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    await ctx.delete(`/console/api/apps/${id}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function syncRunnableWorkflowDraft(appId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    await ctx.post(`/console/api/apps/${appId}/workflows/draft`, {
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
  }
  finally {
    await ctx.dispose()
  }
}

export async function publishWorkflowApp(appId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    await ctx.post(`/console/api/apps/${appId}/workflows/publish`, {
      data: { marked_name: '', marked_comment: '' },
    })
  }
  finally {
    await ctx.dispose()
  }
}

type AppDetailWithSite = {
  site: { access_token: string, app_base_url: string, enable_site: boolean }
}

export async function enableAppSiteAndGetURL(appId: string): Promise<string> {
  const ctx = await createApiContext()
  try {
    await ctx.post(`/console/api/apps/${appId}/site-enable`, {
      data: { enable_site: true },
    })
    const res = await ctx.get(`/console/api/apps/${appId}`)
    const body = (await res.json()) as AppDetailWithSite
    const { app_base_url, access_token } = body.site
    return `${app_base_url}/workflow/${access_token}`
  }
  finally {
    await ctx.dispose()
  }
}
