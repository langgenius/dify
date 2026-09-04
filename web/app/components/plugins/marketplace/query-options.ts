import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import { infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query'
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
    // Hold the previous term's results while the new query is in flight. Without
    // this, `data` goes undefined on every keystroke that survives the debounce,
    // the grid unmounts, the container collapses, and the scroll position jumps —
    // the "jitter" the Marketplace search is reported for. Consumers show a
    // quiet pending state off `isPlaceholderData` instead.
    placeholderData: keepPreviousData,
    // Matches the autocomplete queries. Now that the fetcher propagates
    // failures, react-query's default of 3 retries would hold isFetching true
    // through ~7s of backoff — indistinguishable from a hang. Failing fast and
    // offering an explicit Retry is both honest and fewer requests to abort.
    retry: false,
  })
