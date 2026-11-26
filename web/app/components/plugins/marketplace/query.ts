import type { MarketPlaceInputs, PluginsSearchParams } from '@dify/contracts/marketplace'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/marketplace'
import { getMarketplacePluginsInfiniteQueryOptions } from './query-options'
import { getMarketplaceCollectionsAndPlugins } from './utils'

/** Cache lifetimes for panels that keep the catalog longer than the app default. */
type MarketplaceCacheOptions = {
  staleTime?: number
  gcTime?: number
}

/** The catalog cache the settings and picker panels use: fresh for 5 minutes, kept for 10. */
export const MARKETPLACE_PANEL_CACHE_OPTIONS = {
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 10,
} satisfies MarketplaceCacheOptions

export function useMarketplaceCollectionsAndPlugins(
  collectionsParams: MarketPlaceInputs['collections']['query'],
  enabled = true,
  cacheOptions?: MarketplaceCacheOptions,
) {
  return useQuery({
    queryKey: marketplaceQuery.collections.queryKey({ input: { query: collectionsParams } }),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(collectionsParams, { signal }),
    enabled,
    // Matches the plugins query: the shared client default of 3 retries holds
    // isFetching true for ~7s of backoff, which the catalog renders as a
    // spinner indistinguishable from a hang.
    retry: false,
    ...cacheOptions,
  })
}

type MarketplacePluginsOptions = MarketplaceCacheOptions & {
  enabled?: boolean
  /** Shows the previous search while the next one loads (default). Off, each search starts empty. */
  keepPreviousResults?: boolean
}

export function useMarketplacePlugins(
  queryParams: PluginsSearchParams | undefined,
  { enabled = true, keepPreviousResults = true, ...cacheOptions }: MarketplacePluginsOptions = {},
) {
  const queryOptions = getMarketplacePluginsInfiniteQueryOptions(queryParams)
  return useInfiniteQuery({
    ...queryOptions,
    enabled: enabled && queryOptions.enabled,
    placeholderData: keepPreviousResults ? queryOptions.placeholderData : undefined,
    ...cacheOptions,
  })
}
