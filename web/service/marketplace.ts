import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { marketplaceRouterContract } from '@dify/contracts/marketplace'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { APP_VERSION, IS_MARKETPLACE, MARKETPLACE_API_PREFIX } from '@/config'

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

const marketplaceLink = new OpenAPILink(marketplaceRouterContract, {
  url: MARKETPLACE_API_PREFIX,
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
      console.error(error)
    }),
  ],
})

export const marketplaceClient: JsonifiedClient<
  ContractRouterClient<typeof marketplaceRouterContract>
> = createORPCClient(marketplaceLink)
export const marketplaceQuery = createTanstackQueryUtils(marketplaceClient, {
  path: ['marketplace'],
})
