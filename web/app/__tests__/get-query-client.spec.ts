import { dehydrate, MutationObserver, QueryObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { getQueryClient } from '../get-query-client'

describe('getQueryClient', () => {
  it('preserves the default of no retries for imperative queries', async () => {
    const queryClient = getQueryClient()
    const queryKey = ['failed-imperative-query']
    const error = new Error('Unavailable')
    const queryFn = vi.fn().mockRejectedValue(error)

    await expect(queryClient.query({ queryKey, queryFn })).rejects.toBe(error)

    expect(queryFn).toHaveBeenCalledOnce()
    queryClient.removeQueries({ queryKey })
  })

  it('includes pending queries in dehydrated state', async () => {
    const queryClient = getQueryClient()
    const queryKey = ['pending-dehydration']
    let resolveQuery!: (value: string) => void
    const queryPromise = new Promise<string>((resolve) => {
      resolveQuery = resolve
    })
    const queryExecution = queryClient.query({
      queryKey,
      queryFn: () => queryPromise,
    })

    expect(dehydrate(queryClient).queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queryKey,
          state: expect.objectContaining({ status: 'pending' }),
        }),
      ]),
    )

    resolveQuery('ready')
    await queryExecution
    queryClient.removeQueries({ queryKey })
  })

  it("refreshes the mutation's domain after a console write that no policy covers", async () => {
    const queryClient = getQueryClient()
    const queryKey = consoleQuery.apps.get.queryKey({ input: { query: { page: 1 } } })
    const queryFn = vi.fn(async () => queryFn.mock.calls.length)
    const query = new QueryObserver(queryClient, { queryKey, queryFn, staleTime: Infinity })
    const unsubscribe = query.subscribe(() => undefined)
    await vi.waitFor(() => expect(query.getCurrentResult().data).toBe(1))
    // Freshness is compared by timestamp: the write succeeds after the read.
    await new Promise((resolve) => setTimeout(resolve, 2))

    await new MutationObserver(queryClient, {
      mutationKey: consoleQuery.apps.byAppId.put.mutationKey(),
      mutationFn: async () => 'renamed',
    }).mutate(undefined)

    await vi.waitFor(() => expect(query.getCurrentResult().data).toBe(2))
    unsubscribe()
    queryClient.removeQueries({ queryKey })
  })
})
