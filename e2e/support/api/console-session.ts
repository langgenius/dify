import { request } from '@playwright/test'
import { authStatePath } from '../../fixtures/auth'
import { apiURL } from '../../test-env'
import { createConsoleClient } from './console-client'

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
