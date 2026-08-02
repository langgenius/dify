import type { HomeTemplatesData } from '../home-queries'
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { getHomeTemplatesQueryOptions } from '../home-queries-client'

const mocks = vi.hoisted(() => ({
  fetchAppList: vi.fn(),
}))

vi.mock('@/service/explore', () => ({
  fetchAppList: (...args: unknown[]) => mocks.fetchAppList(...args),
}))

function HydratedTemplates() {
  const { data } = useSuspenseQuery(getHomeTemplatesQueryOptions('en-US'))

  return <div>{data.categories.join(', ')}</div>
}

describe('Home pending query hydration', () => {
  it('should continue a pending server templates query without calling the client query function', async () => {
    let resolveServerQuery: ((data: HomeTemplatesData) => void) | undefined
    const templates: HomeTemplatesData = {
      categories: ['Writing'],
      allList: [],
    }
    const clientQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
    })
    const serverQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const clientTemplatesQuery = getHomeTemplatesQueryOptions('en-US')

    void serverQueryClient.prefetchQuery({
      queryKey: clientTemplatesQuery.queryKey,
      queryFn: () =>
        new Promise<HomeTemplatesData>((resolve) => {
          resolveServerQuery = resolve
        }),
    })
    const dehydratedState = dehydrate(serverQueryClient, {
      shouldDehydrateQuery: (query) => query.state.status === 'pending',
    })

    render(
      <QueryClientProvider client={clientQueryClient}>
        <HydrationBoundary state={dehydratedState}>
          <Suspense
            fallback={
              <div role="status" aria-label="Loading templates">
                Loading templates
              </div>
            }
          >
            <HydratedTemplates />
          </Suspense>
        </HydrationBoundary>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeInTheDocument()
    expect(mocks.fetchAppList).not.toHaveBeenCalled()

    await act(async () => {
      resolveServerQuery?.(templates)
    })

    expect(await screen.findByText('Writing')).toBeInTheDocument()
    expect(mocks.fetchAppList).not.toHaveBeenCalled()
  })
})
