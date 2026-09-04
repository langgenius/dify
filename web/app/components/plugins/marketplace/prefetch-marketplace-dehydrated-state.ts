import type { SearchParams } from 'nuqs/server'
import type { MarketplaceSearchParams } from './search-params'
import { dehydrate, noop } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClient } from '@/app/get-query-client'
import { marketplaceQuery } from '@/service/client'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { getMarketplacePluginsInfiniteQueryOptions } from './query-options'
import {
  getMarketplacePluginsSearchParams,
  marketplaceSearchParamsParsers,
  shouldSearchMarketplacePlugins,
} from './search-params'
import { withinServerBudget } from './server-budget'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

export async function prefetchMarketplaceDehydratedState(searchParams?: Promise<SearchParams>) {
  if (!searchParams) {
    return
  }
  const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
  const params: MarketplaceSearchParams = await loadSearchParams(searchParams)

  const queryClient = getQueryClient()

  if (shouldSearchMarketplacePlugins(params)) {
    await withinServerBudget(
      queryClient
        .infiniteQuery(
          getMarketplacePluginsInfiniteQueryOptions(getMarketplacePluginsSearchParams(params)),
        )
        .catch(noop),
    )
    return dehydrate(queryClient)
  }

  if (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(params.category)) return

  await withinServerBudget(
    queryClient
      .query({
        queryKey: marketplaceQuery.collections.queryKey({
          input: { query: getCollectionsParams(params.category) },
        }),
        queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
      })
      .catch(noop),
  )
  return dehydrate(queryClient)
}
