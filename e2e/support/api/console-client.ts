import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { APIRequestContext } from '@playwright/test'
import type { ConsoleClientContext } from './playwright-fetch'
import { consoleRouterContract } from '@dify/contracts/api/console/router.gen'
import { createORPCClient } from '@orpc/client'
import { RequestValidationPlugin, ResponseValidationPlugin } from '@orpc/contract/plugins'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { apiURL } from '../../test-env'
import { createPlaywrightFetch } from './playwright-fetch'

type ConsoleRequestContext = Pick<APIRequestContext, 'fetch' | 'storageState'>

export type ConsoleClient = JsonifiedClient<
  ContractRouterClient<typeof consoleRouterContract, ConsoleClientContext>
>

export type CreateConsoleClientOptions = {
  apiBaseURL?: string
  requestContext: ConsoleRequestContext
  requireCsrfToken?: boolean
}

const getCsrfToken = async (requestContext: ConsoleRequestContext) => {
  const state = await requestContext.storageState()
  return state.cookies.find((cookie) => cookie.name.endsWith('csrf_token'))?.value
}

export function createConsoleClient({
  apiBaseURL = apiURL,
  requestContext,
  requireCsrfToken = true,
}: CreateConsoleClientOptions): ConsoleClient {
  const link = new OpenAPILink<ConsoleClientContext>(consoleRouterContract, {
    fetch: createPlaywrightFetch(requestContext),
    headers: async () => {
      const headers = new Headers({ Accept: 'application/json' })
      const csrfToken = await getCsrfToken(requestContext)
      if (!csrfToken && requireCsrfToken)
        throw new Error('The Console API client requires an authenticated CSRF token.')
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
      return headers
    },
    plugins: [
      new RequestValidationPlugin<ConsoleClientContext>(consoleRouterContract),
      new ResponseValidationPlugin<ConsoleClientContext>(consoleRouterContract),
    ],
    url: new URL('/console/api/', apiBaseURL).toString(),
  })

  return createORPCClient<ConsoleClient>(link)
}
