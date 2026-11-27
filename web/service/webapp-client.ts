import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { OnUploadProgress } from './xhr-fetch'
import { contract as generatedWebAppContract } from '@dify/contracts/api/web/orpc.gen'
import { webAppSsoContract } from '@dify/contracts/sso'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The WebApp HTTP adapter must preserve the public request layer's passport, access-scope, and error handling.
import { request } from './base'
import { getWebAppPublicApiPath, resolveWebAppAddress } from './webapp-address'

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

const getPublicApiBaseURL = () => new URL(PUBLIC_API_PREFIX, window.location.origin)

const getContractPath = (url: URL) => {
  const basePath = getPublicApiBaseURL().pathname.replace(/\/$/, '')
  return url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname
}

// `new Request(url, request)` would carry the body over as a stream, which needs `duplex`.
// Firefox has no `Request.body`, so read the body for every method that can carry one.
const withURL = async (input: Request, url: URL) => {
  if (url.href === input.url) return input
  return new Request(url, {
    method: input.method,
    headers: input.headers,
    body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.blob(),
    signal: input.signal,
    credentials: input.credentials,
    cache: input.cache,
    redirect: input.redirect,
  })
}

/** Generated WebApp API client that reuses the `isPublicAPI` transport of the legacy request helpers. */
export const webAppClient: JsonifiedClient<
  ContractRouterClient<typeof webAppContract, WebAppClientContext>
> = createORPCClient(
  new OpenAPILink<WebAppClientContext>(webAppContract, {
    url: getPublicApiBaseURL,
    headers: ({ context }) => context.headers ?? {},
    fetch: async (input, init, { context }) => {
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
        request: await withURL(input, publicURL),
        onUploadProgress: context.onUploadProgress,
        timeout: context.stream || context.timeout === false ? false : undefined,
      })
    },
  }),
)
