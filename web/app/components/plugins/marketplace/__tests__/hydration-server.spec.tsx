import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { marketplaceQuery } from '@/service/marketplace'

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

vi.mock('@/service/marketplace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/marketplace')>()),
  marketplaceClient: {
    collections: (...args: unknown[]) => mockCollections(...args),
    collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
    searchAdvanced: (...args: unknown[]) => mockSearchAdvanced(...args),
  },
}))

let queryClient: QueryClient

vi.mock('@/app/get-query-client', () => {
  return {
    getQueryClient: () => queryClient,
  }
})

describe('HydrateQueryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
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

  it('renders the shell without fetching when search parameters are absent', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')
    const element = await HydrateQueryClient({
      searchParams: undefined,
      children: <div>Child Content</div>,
    })
    render(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>)
    expect(screen.getByText('Child Content')).toBeInTheDocument()
    expect(mockCollections).not.toHaveBeenCalled()
    expect(mockSearchAdvanced).not.toHaveBeenCalled()
  })

  it('hydrates the prefetched collection data into the client cache', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')
    const element = await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'all' }),
      children: <div>Child</div>,
    })
    const renderClient = new QueryClient()
    render(<QueryClientProvider client={renderClient}>{element}</QueryClientProvider>)
    expect(mockCollections).toHaveBeenCalledOnce()
    expect(
      renderClient.getQueryData(marketplaceQuery.collections.queryKey({ input: { query: {} } })),
    ).toEqual({
      marketplaceCollections: [],
      marketplaceCollectionPluginsMap: {},
    })
  })

  it('should prefetch when category has collections (tool)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'tool' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).toHaveBeenCalled()
  })

  it('should prefetch plugin search when q is present', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'all', q: 'openai' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).not.toHaveBeenCalled()
    expect(mockSearchAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { kind: 'plugins' },
        body: expect.objectContaining({
          page: 1,
          query: 'openai',
        }),
      }),
      expect.any(Object),
    )
  })

  it('should prefetch when category does not have collections (model)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'model' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).not.toHaveBeenCalled()
    expect(mockSearchAdvanced).toHaveBeenCalled()
  })

  it('should prefetch when category does not have collections (bundle)', async () => {
    const { HydrateQueryClient } = await import('../hydration-server')

    await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'bundle' }),
      children: <div>Child</div>,
    })

    expect(mockCollections).not.toHaveBeenCalled()
    expect(mockSearchAdvanced).toHaveBeenCalled()
  })

  it('should keep the catalog shell when collections prefetch fails', async () => {
    mockCollections.mockRejectedValue(new Error('collections unavailable'))
    const { HydrateQueryClient } = await import('../hydration-server')

    const element = await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'all' }),
      children: <div>Child</div>,
    })

    const renderClient = new QueryClient()
    const { getByText } = render(
      <QueryClientProvider client={renderClient}>{element}</QueryClientProvider>,
    )
    expect(getByText('Child')).toBeInTheDocument()
  })

  it('should keep the catalog shell when plugin search prefetch fails', async () => {
    mockSearchAdvanced.mockRejectedValue(new Error('search unavailable'))
    const { HydrateQueryClient } = await import('../hydration-server')

    const element = await HydrateQueryClient({
      searchParams: Promise.resolve({ category: 'all', q: 'openai' }),
      children: <div>Child</div>,
    })

    const renderClient = new QueryClient()
    const { getByText } = render(
      <QueryClientProvider client={renderClient}>{element}</QueryClientProvider>,
    )
    expect(getByText('Child')).toBeInTheDocument()
  })
})
