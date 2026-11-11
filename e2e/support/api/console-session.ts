import { request } from '@playwright/test'
import { authStatePath } from '../../fixtures/auth.ts'
import { apiURL } from '../../test-env.ts'
import { createConsoleClient } from './console-client.ts'

export async function createStandaloneConsoleSession() {
  const requestContext = await request.newContext({
    baseURL: apiURL,
    storageState: authStatePath,
  })

  return {
    client: createConsoleClient({ requestContext }),
    dispose: () => requestContext.dispose(),
  }
}
