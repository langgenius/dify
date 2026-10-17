import type { RouterContractClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi'
import type { APIRequestContext } from '@playwright/test'
import type { ConsoleClientContext } from './playwright-fetch.ts'
import { consoleRouterContract } from '@dify/contracts/api/console/router.gen'
import { createORPCClient } from '@orpc/client'
import { RequestValidationLinkPlugin, ResponseValidationLinkPlugin } from '@orpc/contract/plugins'
import { OpenAPILink } from '@orpc/openapi/fetch'
import { apiURL } from '../../test-env.ts'
import { ConsoleHttpError } from './console-error.ts'
import { createPlaywrightFetch } from './playwright-fetch.ts'

type ConsoleRequestContext = Pick<APIRequestContext, 'fetch' | 'storageState'>

export type ConsoleClient = JsonifiedClient<
  RouterContractClient<typeof consoleRouterContract, ConsoleClientContext>
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
    customErrorResponseBodyDecoder: (body, response) => new ConsoleHttpError(response.status, body),
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
      new RequestValidationLinkPlugin<ConsoleClientContext>(consoleRouterContract),
      new ResponseValidationLinkPlugin<ConsoleClientContext>(consoleRouterContract),
    ],
    origin: new URL(apiBaseURL).origin,
    url: '/console/api',
  })

  return createORPCClient<ConsoleClient>(link)
}
