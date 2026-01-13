import type { PluginsSearchParams } from './types'
import type { MarketPlaceInputs } from '@/contract/router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/client'
import { getMarketplaceCollectionsAndPlugins, getMarketplacePlugins } from './utils'

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
    queryKey: marketplaceQuery.searchAdvanced.queryKey({
      input: {
        body: queryParams!,
        params: { kind: queryParams?.type === 'bundle' ? 'bundles' : 'plugins' },
      },
    }),
    queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.page_size
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: queryParams !== undefined,
  })
}
