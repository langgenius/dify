import { dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '../get-query-client'

describe('getQueryClient', () => {
  it('includes pending queries in dehydrated state', async () => {
    const queryClient = getQueryClient()
    const queryKey = ['pending-dehydration']
    let resolveQuery!: (value: string) => void
    const queryPromise = new Promise<string>((resolve) => {
      resolveQuery = resolve
    })
    const prefetchPromise = queryClient.prefetchQuery({
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
    await prefetchPromise
    queryClient.removeQueries({ queryKey })
  })
})
