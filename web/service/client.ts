import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  API_PREFIX,
  APP_VERSION,
  IS_MARKETPLACE,
  MARKETPLACE_API_PREFIX,
} from '@/config'
import {
  consoleRouterContract,
  marketplaceRouterContract,
} from '@/contract/router'
import { isClient } from '@/utils/client'
import { request } from './base'

const getMarketplaceHeaders = () => new Headers({
  'X-Dify-Version': !IS_MARKETPLACE ? APP_VERSION : '999.0.0',
})

function isURL(path: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(path)
    return true
  }
  catch {
    return false
  }
}

export function getBaseURL(path: string) {
  const url = new URL(path, isURL(path) ? undefined : isClient ? window.location.origin : 'http://localhost')

  if (!isClient && !isURL(path)) {
    console.warn('Using localhost as base URL in server environment, please configure accordingly.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    console.warn(`Unexpected protocol for API requests, expected http or https. Current protocol: ${url.protocol}. Please configure accordingly.`)
  }

  return url
}

const marketplaceLink = new OpenAPILink(marketplaceRouterContract, {
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

export const marketplaceClient: JsonifiedClient<ContractRouterClient<typeof marketplaceRouterContract>> = createORPCClient(marketplaceLink)
export const marketplaceQuery = createTanstackQueryUtils(marketplaceClient, { path: ['marketplace'] })

const consoleLink = new OpenAPILink(consoleRouterContract, {
  url: getBaseURL(API_PREFIX),
  fetch: (input, init) => {
    return request(
      input.url,
      init,
      {
        fetchCompat: true,
        request: input,
      },
    )
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const consoleClient: JsonifiedClient<ContractRouterClient<typeof consoleRouterContract>> = createORPCClient(consoleLink)
export const consoleQuery = createTanstackQueryUtils(consoleClient, { path: ['console'] })
