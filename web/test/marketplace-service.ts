import type * as MarketplaceService from '@/service/marketplace'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

type MarketplaceClient = typeof MarketplaceService.marketplaceClient
type MarketplaceResponses = {
  [K in keyof MarketplaceClient]?: MarketplaceClient[K] extends (...args: infer Args) => unknown
    ? (...args: Args) => unknown
    : never
}

/**
 * Stub selected Marketplace contract routes for `vi.mock('@/service/marketplace')`. Both the
 * client and the query utils read through the stubs, so contract keys and query options stay real.
 */
export function withMarketplaceResponses(
  actual: typeof MarketplaceService,
  responses: MarketplaceResponses,
): typeof MarketplaceService {
  const marketplaceClient = new Proxy(actual.marketplaceClient, {
    get(target, property, receiver) {
      if (typeof property === 'string' && Object.hasOwn(responses, property))
        return responses[property as keyof MarketplaceResponses]
      return Reflect.get(target, property, receiver)
    },
  })
  return {
    ...actual,
    marketplaceClient,
    marketplaceQuery: createTanstackQueryUtils(marketplaceClient, { path: ['marketplace'] }),
  }
}
