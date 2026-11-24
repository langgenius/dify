import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { contract as webAppContract } from '@dify/contracts/api/web/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The WebApp HTTP adapter must preserve the public request layer's passport, access-scope, and error handling.
import { request } from './base'
import { getWebAppPublicApiPath, resolveWebAppAddress } from './webapp-address'

type WebAppClientContext = {
  silent?: boolean
  headers?: Record<string, string>
}

const getPublicApiBaseURL = () => new URL(PUBLIC_API_PREFIX, window.location.origin)

const getContractPath = (url: URL) => {
  const basePath = getPublicApiBaseURL().pathname.replace(/\/$/, '')
  return url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname
}

/** Generated WebApp API client that reuses the `isPublicAPI` transport of the legacy request helpers. */
export const webAppClient: JsonifiedClient<
  ContractRouterClient<typeof webAppContract, WebAppClientContext>
> = createORPCClient(
  new OpenAPILink<WebAppClientContext>(webAppContract, {
    url: getPublicApiBaseURL,
    headers: ({ context }) => context.headers ?? {},
    fetch: (input, init, { context }) => {
      const contractURL = new URL(input.url)
      const contractPath = getContractPath(contractURL)
      const publicURL = new URL(
        `${PUBLIC_API_PREFIX}${getWebAppPublicApiPath(resolveWebAppAddress(), contractPath)}${contractURL.search}`,
        window.location.origin,
      )
      // oxlint-disable-next-line typescript/no-deprecated -- Generated WebApp calls need the shared public authentication and access-error transport.
      return request<Response>(`${contractPath}${contractURL.search}`, init, {
        isPublicAPI: true,
        fetchCompat: true,
        request: new Request(publicURL, input),
        silent: context.silent,
      })
    },
  }),
)
