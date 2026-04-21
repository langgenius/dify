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

export async function deleteTestApp(id: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    await ctx.delete(`/console/api/apps/${id}`)
  }
  finally {
    await ctx.dispose()
  }
}
