import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  APP_VERSION,
  IS_MARKETPLACE,
  MARKETPLACE_API_PREFIX,
} from '@/config'
import { marketplaceRouterContract } from '@/contract/router'

const getMarketplaceHeaders = () => new Headers({
  'X-Dify-Version': !IS_MARKETPLACE ? APP_VERSION : '999.0.0',
})

const link = new OpenAPILink(marketplaceRouterContract, {
  url: MARKETPLACE_API_PREFIX,
  headers: () => (getMarketplaceHeaders()),
  fetch: (request, init) => {
    return globalThis.fetch(request, {
      ...init,
      cache: 'no-store',
    })
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const marketplaceClient: JsonifiedClient<ContractRouterClient<typeof marketplaceRouterContract>> = createORPCClient(link)
export const marketplaceClientQuery = createTanstackQueryUtils(marketplaceClient)
