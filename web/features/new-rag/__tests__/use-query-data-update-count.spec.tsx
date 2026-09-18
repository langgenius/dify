import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useQueryDataUpdateCount } from '../use-query-data-update-count'

const queryKey = ['task-generation'] as const
const sharedPage = { items: ['task-1'] }

function GenerationProbe({ queryClient }: { queryClient: QueryClient }) {
  const query = useInfiniteQuery({
    queryFn: async () => sharedPage,
    initialPageParam: null,
    getNextPageParam: () => undefined,
    queryKey,
  })
  const dataUpdateCount = useQueryDataUpdateCount(queryClient, queryKey)

  return (
    <output>
      {query.data ? 'ready' : 'pending'}:{query.dataUpdatedAt}:{dataUpdateCount}
    </output>
  )
}

describe('useQueryDataUpdateCount', () => {
  it('observes a real same-reference refetch when response timestamps collide', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <GenerationProbe queryClient={queryClient} />
      </QueryClientProvider>,
    )

    try {
      await screen.findByText('ready:100:1')
      const firstData = queryClient.getQueryData(queryKey)

      await act(async () => queryClient.refetchQueries({ queryKey }))

      await waitFor(() => expect(screen.getByText('ready:100:2')).toBeInTheDocument())
      expect(queryClient.getQueryData(queryKey)).toBe(firstData)
    } finally {
      rendered.unmount()
      queryClient.clear()
      vi.restoreAllMocks()
    }
  })
})
