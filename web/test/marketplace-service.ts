import type * as MarketplaceService from '@/service/marketplace'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

type Responses<T> = {
  [K in keyof T]?: T[K] extends (...args: infer Args) => unknown
    ? (...args: Args) => unknown
    : Responses<T[K]>
}

const withResponses = <T extends object>(target: T, responses: Responses<T>): T =>
  new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver)
      if (typeof property !== 'string' || !Object.hasOwn(responses, property)) return value
      const response = responses[property as keyof T]
      if (typeof response === 'function') return response
      return withResponses(value as object, response as Responses<object>)
    },
  })

/**
 * Stub selected Marketplace contract routes for `vi.mock('@/service/marketplace')`. Both the
 * client and the query utils read through the stubs, so contract keys and query options stay real.
 */
export function withMarketplaceResponses(
  actual: typeof MarketplaceService,
  responses: Responses<typeof MarketplaceService.marketplaceClient>,
): typeof MarketplaceService {
  const marketplaceClient = withResponses(actual.marketplaceClient, responses)
  return {
    ...actual,
    marketplaceClient,
    marketplaceQuery: createTanstackQueryUtils(marketplaceClient, { path: ['marketplace'] }),
  }
}
