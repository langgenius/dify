import { dehydrate } from '@tanstack/react-query'
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
})
