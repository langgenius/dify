import type { APIResponse } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { request } from '@playwright/test'
import * as z from 'zod'
import { authStatePath } from '../../fixtures/auth'
import { apiURL } from '../../test-env'

const zStorageState = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    }),
  ),
})

export async function createConsoleApiContext() {
  const state = zStorageState.parse(JSON.parse(await readFile(authStatePath, 'utf8')))
  const csrfToken = state.cookies.find((cookie) => cookie.name.endsWith('csrf_token'))?.value
  if (!csrfToken) throw new Error(`No CSRF token found in E2E auth state: ${authStatePath}`)

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
