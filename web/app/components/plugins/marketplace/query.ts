import type { MarketPlaceInputs, PluginsSearchParams } from '@dify/contracts/marketplace'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/client'
import { getMarketplacePluginsInfiniteQueryOptions } from './query-options'
import { getMarketplaceCollectionsAndPlugins } from './utils'

export function useMarketplaceCollectionsAndPlugins(
  collectionsParams: MarketPlaceInputs['collections']['query'],
  enabled = true,
) {
  return useQuery({
    queryKey: marketplaceQuery.collections.queryKey({ input: { query: collectionsParams } }),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(collectionsParams, { signal }),
    enabled,
    // Matches the plugins query: the shared client default of 3 retries holds
    // isFetching true for ~7s of backoff, which the catalog renders as a
    // spinner indistinguishable from a hang.
    retry: false,
  })
}

export function useMarketplacePlugins(queryParams: PluginsSearchParams | undefined) {
  return useInfiniteQuery(getMarketplacePluginsInfiniteQueryOptions(queryParams))
}
