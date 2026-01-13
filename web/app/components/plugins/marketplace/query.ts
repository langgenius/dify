import type { CollectionsAndPluginsSearchParams, PluginsSearchParams } from './types'
import type { MarketPlaceInputs } from '@/contract/router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/client'
import { getMarketplaceCollectionsAndPlugins, getMarketplacePlugins } from './utils'

// TODO: Avoid manual maintenance of query keys and better service management,
// https://github.com/langgenius/dify/issues/30342

export const marketplaceKeys = {
  all: ['marketplace'] as const,
  collectionPlugins: (collectionId: string, params?: CollectionsAndPluginsSearchParams) => [...marketplaceKeys.all, 'collectionPlugins', collectionId, params] as const,
  plugins: (params?: PluginsSearchParams) => [...marketplaceKeys.all, 'plugins', params] as const,
}

export function useMarketplaceCollectionsAndPlugins(
  collectionsParams: MarketPlaceInputs['collections']['query'],
) {
  return useQuery({
    queryKey: marketplaceQuery.collections.queryKey({ input: { query: collectionsParams } }),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(collectionsParams, { signal }),
  })
}

export function useMarketplacePlugins(
  queryParams: PluginsSearchParams | undefined,
) {
  return useInfiniteQuery({
    queryKey: marketplaceKeys.plugins(queryParams),
    queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.pageSize
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: queryParams !== undefined,
  })
}
