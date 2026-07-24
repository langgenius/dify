import type { DehydratedState } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({
  API_PREFIX: '/api',
  APP_VERSION: '1.0.0',
  IS_MARKETPLACE: false,
  MARKETPLACE_API_PREFIX: 'https://marketplace.dify.ai/api/v1',
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.dify.ai${path}`,
}))

const mockCollections = vi.fn()
const mockCollectionPlugins = vi.fn()

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    collections: (...args: unknown[]) => mockCollections(...args),
    collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
  },
  marketplaceQuery: {
    collections: {
      queryKey: (params: unknown) => ['marketplace', 'collections', params],
    },
  },
}))

let rootQueryClient: QueryClient

vi.mock('@/context/query-client-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/query-client-server')>()

  return {
    ...actual,
    getQueryClientServer: () => rootQueryClient,
  }
})

describe('HydrateQueryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rootQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    mockCollections.mockResolvedValue({
      data: { collections: [] },
    })
    mockCollectionPlugins.mockResolvedValue({
      data: { plugins: [] },
    })
  })

  it('should render children within HydrationBoundary', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    const element = await HydrateQueryClient({
      searchParams: undefined,
      children: <div data-testid="child">Child Content</div>,
    })

    const renderClient = new QueryClient()
    const { getByText } = render(
      <QueryClientProvider client={renderClient}>
        {element as React.ReactElement}
      </QueryClientProvider>,
    )
    expect(getByText('Child Content')).toBeInTheDocument()
  })

  it('should not prefetch when searchParams is undefined', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: undefined,
      children: <div>Child</div>,
    })

    expect(mockCollections).not.toHaveBeenCalled()
  })

  it('should prefetch when category has collections (all)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'all' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
  })

  it('should dehydrate only Marketplace-owned queries', async () => {
    rootQueryClient.setQueryData(['console', 'system-features'], {
      deployment_edition: 'CLOUD',
    })
    const { HydrateQueryClient } = await import('../hydration-server')

    const element = await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'all' }),
      children: <div>Child</div>,
    })
    const state = (element as ReactElement<{ state: DehydratedState }>).props.state

    expect(state.queries).toHaveLength(1)
    expect(state.queries[0]?.queryKey).toEqual([
      'marketplace',
      'collections',
      { input: { query: {} } },
    ])
  })

  it('should prefetch when category has collections (tool)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'tool' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
  })

  it('should not prefetch when category does not have collections (model)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'model' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).not.toHaveBeenCalled()
  })

  it('should not prefetch when category does not have collections (bundle)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'bundle' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).not.toHaveBeenCalled()
  })
})
