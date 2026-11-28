import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { marketplaceRouterContract } from '@dify/contracts/marketplace'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { APP_VERSION, IS_MARKETPLACE } from '@/config'
import { MARKETPLACE_API_PREFIX } from '@/features/marketplace/api'
import { reportClientError } from './client-error'
import { createHttpError } from './http-error'

// 15s deadline so a stalled Marketplace fetch can error/retry.
const MARKETPLACE_REQUEST_TIMEOUT_MS = 15_000

// Preserve caller cancellation alongside the Marketplace deadline.
function withRequestDeadline(callerSignal: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(MARKETPLACE_REQUEST_TIMEOUT_MS)
  if (callerSignal.aborted) return callerSignal

  const controller = new AbortController()
  callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), {
    once: true,
  })
  deadline.addEventListener('abort', () => controller.abort(deadline.reason), { once: true })
  return controller.signal
}

function toHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      result.append(name, item)
  }
  return result
}

const marketplaceLink = new OpenAPILink(marketplaceRouterContract, {
  url: MARKETPLACE_API_PREFIX,
  // Failed responses decode like the console transport's, so error owners read one shape.
  customErrorResponseBodyDecoder: (body, response) =>
    createHttpError(
      { status: response.status, statusText: '', headers: toHeaders(response.headers) },
      body,
    ),
  headers: () => ({
    'X-Dify-Version': !IS_MARKETPLACE ? APP_VERSION : '999.0.0',
  }),
  fetch: (request, init) => {
    return globalThis.fetch(request, {
      ...init,
      cache: 'no-store',
      signal: new URL(request.url).pathname.endsWith('/download')
        ? request.signal
        : withRequestDeadline(request.signal),
    })
  },
  interceptors: [
    onError((error) => {
      reportClientError(error)
    }),
  ],
})

export const marketplaceClient: JsonifiedClient<
  ContractRouterClient<typeof marketplaceRouterContract>
> = createORPCClient(marketplaceLink)
export const marketplaceQuery = createTanstackQueryUtils(marketplaceClient, {
  path: ['marketplace'],
})
