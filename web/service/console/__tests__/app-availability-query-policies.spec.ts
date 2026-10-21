import type { AppPagination } from '@dify/contracts/api/console/apps/types.gen'
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

it.each([false, true])(
  'refreshes dependency availability when returning to the list (starred: %s)',
  async (starred) => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
    })
    let availability: 'available' | 'unavailable' = 'unavailable'
    const queryFn = async (): Promise<AppPagination> => ({
      page: 1,
      limit: 30,
      total: 1,
      has_more: false,
      data: [{ id: 'app', name: 'Repairable app', mode: 'workflow', icon_url: null, availability }],
    })
    const observer = starred
      ? new QueryObserver(client, {
          ...consoleQuery.apps.starred.get.queryOptions({ input: { query: {} } }),
          queryFn,
        })
      : new InfiniteQueryObserver(client, {
          ...consoleQuery.apps.get.infiniteOptions({
            input: (page) => ({ query: { page } }),
            initialPageParam: 1,
            getNextPageParam: () => undefined,
          }),
          queryFn,
        })
    let stop = observer.subscribe(() => {})
    const expectStatus = (status: typeof availability) =>
      expect(observer.getCurrentResult()).toMatchObject({
        data: starred
          ? { data: [{ availability: status }] }
          : { pages: [{ data: [{ availability: status }] }] },
      })
    try {
      await vi.waitFor(() => expectStatus('unavailable'))
      stop()
      availability = 'available'
      stop = observer.subscribe(() => {})
      await vi.waitFor(() => expectStatus('available'))
    } finally {
      stop()
      client.clear()
    }
  },
)
