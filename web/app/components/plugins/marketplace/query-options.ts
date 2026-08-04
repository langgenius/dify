import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/client'
import { getMarketplacePlugins } from './utils'

export const getMarketplacePluginsInfiniteQueryOptions = (
  queryParams: PluginsSearchParams | undefined,
) =>
  infiniteQueryOptions({
    queryKey: marketplaceQuery.searchAdvanced.queryKey({
      input: {
        body: queryParams ?? { query: '' },
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
