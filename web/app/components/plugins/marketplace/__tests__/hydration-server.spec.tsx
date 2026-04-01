import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => name === 'sec-fetch-dest' ? 'document' : null,
  }),
}))

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
const mockSearchAdvanced = vi.fn()

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    plugins: {
      collections: (...args: unknown[]) => mockCollections(...args),
      collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
      searchAdvanced: (...args: unknown[]) => mockSearchAdvanced(...args),
    },
  },
  marketplaceQuery: {
    plugins: {
      collections: {
        queryKey: (params: unknown) => ['marketplace', 'plugins', 'collections', params],
      },
      searchAdvanced: {
        queryKey: (params: unknown) => ['marketplace', 'plugins', 'searchAdvanced', params],
      },
    },
  },
}))

let serverQueryClient: QueryClient

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => serverQueryClient,
}))

describe('HydrateQueryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    mockCollections.mockResolvedValue({
      data: { collections: [] },
    })
    mockCollectionPlugins.mockResolvedValue({
      data: { plugins: [] },
    })
    mockSearchAdvanced.mockResolvedValue({
      data: { plugins: [], total: 0 },
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
      isMarketplacePlatform: true,
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
  })

  it('should prefetch when category has collections (tool)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'tool' }),
      isMarketplacePlatform: true,
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
  })

  it('should prefetch search results when category does not have collections (model)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'model' }),
      isMarketplacePlatform: true,
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
    expect(mockSearchAdvanced).toHaveBeenCalled()
  })

  it('should prefetch search results when category does not have collections (bundle)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'bundle' }),
      isMarketplacePlatform: true,
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
    expect(mockSearchAdvanced).toHaveBeenCalled()
  })
})
