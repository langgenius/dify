import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

describe('dataset list invalidation key', () => {
  // Creation and settings flows invalidate `consoleQuery.datasets.get.key()`; it must cover the
  // infinite list query the datasets page renders, whatever filters it was opened with.
  it('marks the generated infinite dataset list stale', () => {
    const queryClient = new QueryClient()
    const { queryKey } = consoleQuery.datasets.get.infiniteOptions({
      input: (pageParam: number) => ({
        query: { page: pageParam, limit: 30, include_all: false, keyword: 'handbook' },
      }),
      getNextPageParam: () => undefined,
      initialPageParam: 1,
    })
    queryClient.setQueryData(queryKey, { pages: [], pageParams: [] })

    void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })

    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
  })
})
