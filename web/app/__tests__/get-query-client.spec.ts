import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createElement, Suspense } from 'react'
import { getQueryClient } from '../get-query-client'

function PendingQuery({
  queryKey,
  queryFn,
}: {
  queryKey: string[]
  queryFn: () => Promise<string>
}) {
  const { data } = useSuspenseQuery({ queryKey, queryFn })
  return createElement('div', null, data)
}

describe('getQueryClient', () => {
  it('includes pending queries in dehydrated state', async () => {
    const queryClient = getQueryClient()
    const queryKey = ['pending-dehydration']
    let resolveQuery!: (value: string) => void
    const queryPromise = new Promise<string>((resolve) => {
      resolveQuery = resolve
    })
    const serverQueryFn = vi.fn(() => queryPromise)
    const queryExecution = queryClient.query({
      queryKey,
      queryFn: serverQueryFn,
    })
    const dehydratedState = dehydrate(queryClient)

    expect(dehydratedState.queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queryKey,
          state: expect.objectContaining({ status: 'pending' }),
        }),
      ]),
    )

    const clientQueryFn = vi.fn(async () => 'client fallback')
    const browserQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      createElement(
        QueryClientProvider,
        { client: browserQueryClient },
        createElement(
          HydrationBoundary,
          { state: dehydratedState },
          createElement(
            Suspense,
            { fallback: createElement('div', null, 'Loading pending query') },
            createElement(PendingQuery, { queryKey, queryFn: clientQueryFn }),
          ),
        ),
      ),
    )
    expect(screen.getByText('Loading pending query')).toBeInTheDocument()

    resolveQuery('ready')
    await queryExecution
    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(serverQueryFn).toHaveBeenCalledTimes(1)
    expect(clientQueryFn).not.toHaveBeenCalled()
    queryClient.removeQueries({ queryKey })
    browserQueryClient.clear()
  })
})
