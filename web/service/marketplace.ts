import type { RouterContractClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi'
import { marketplaceRouterContract } from '@dify/contracts/marketplace'
import { createORPCClient, onError } from '@orpc/client'
import { TimeoutLinkPlugin } from '@orpc/client/plugins'
import { OpenAPILink } from '@orpc/openapi/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { APP_VERSION, IS_MARKETPLACE, MARKETPLACE_API_PREFIX } from '@/config'
import { toOpenAPILinkBase } from './console/openapi-url'
import { httpErrorFromStandardResponse } from './http-error'

// 15s deadline so a stalled Marketplace fetch can error/retry; package downloads may run longer.
const MARKETPLACE_REQUEST_TIMEOUT_MS = 15_000

const marketplaceLink = new OpenAPILink(marketplaceRouterContract, {
  ...toOpenAPILinkBase(MARKETPLACE_API_PREFIX),
  headers: () => ({
    'X-Dify-Version': !IS_MARKETPLACE ? APP_VERSION : '999.0.0',
  }),
  fetch: (url, init) => globalThis.fetch(url, { ...init, cache: 'no-store' }),
  customErrorResponseBodyDecoder: httpErrorFromStandardResponse,
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
  plugins: [
    new TimeoutLinkPlugin({
      timeout: ({ path }) =>
        path.at(-1) === 'downloadPlugin' ? undefined : MARKETPLACE_REQUEST_TIMEOUT_MS,
    }),
  ],
})

export const marketplaceClient: JsonifiedClient<
  RouterContractClient<typeof marketplaceRouterContract>
> = createORPCClient(marketplaceLink)
export const marketplaceQuery = createTanstackQueryUtils(marketplaceClient, {
  prefix: 'marketplace',
})
