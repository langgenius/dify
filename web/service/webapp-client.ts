import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { OnUploadProgress } from './xhr-fetch'
import { contract as generatedWebAppContract } from '@dify/contracts/api/web/orpc.gen'
import { webAppSsoContract } from '@dify/contracts/sso'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
// oxlint-disable-next-line no-restricted-imports -- The WebApp HTTP adapter must preserve the public request layer's passport, access-scope, and error handling.
import { request } from './base'
import { resolveWebAppAddress } from './webapp-address'
import {
  getWebAppApiBaseURL,
  getWebAppApiRoute,
  scopeWebAppRequestURL,
  withWebAppRequestURL,
} from './webapp-request'

type WebAppClientContext = {
  /** The response is an event stream: no time limit on its first frame. */
  stream?: boolean
  /** `false` lifts the time limit, e.g. for uploads the server finishes only after fetching a remote file. */
  timeout?: false
  headers?: Record<string, string>
  /** Reports request-body upload progress; the call is sent over XHR without the default timeout. */
  onUploadProgress?: OnUploadProgress
}

const webAppContract = {
  ...generatedWebAppContract,
  enterprise: { sso: webAppSsoContract },
}

/** Generated WebApp API client that reuses the `isPublicAPI` transport of the legacy request helpers. */
export const webAppClient: JsonifiedClient<
  ContractRouterClient<typeof webAppContract, WebAppClientContext>
> = createORPCClient(
  new OpenAPILink<WebAppClientContext>(webAppContract, {
    url: getWebAppApiBaseURL,
    headers: ({ context }) => context.headers ?? {},
    fetch: async (input, init, { context }) => {
      const route = getWebAppApiRoute(input.url)
      const publicURL = scopeWebAppRequestURL(route, resolveWebAppAddress(), {
        preserveConfiguredPrefix: true,
      })
      // A browser may expose blob() without Request.body, so use the method for uploads.
      const readBody = input.method !== 'GET' && input.method !== 'HEAD'
      // oxlint-disable-next-line typescript/no-deprecated -- Generated WebApp calls need the shared public authentication and access-error transport.
      return request<Response>(`${route.path}${route.url.search}`, init, {
        isPublicAPI: true,
        fetchCompat: true,
        request: await withWebAppRequestURL(input, publicURL, readBody),
        onUploadProgress: context.onUploadProgress,
        timeout: context.stream || context.timeout === false ? false : undefined,
      })
    },
  }),
)
