import { render, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n-config/i18next-config', () => ({
  default: {
    getFixedT: () => (key: string) => key,
  },
}))

const mockSetUrlFilters = vi.fn()
vi.mock('@/hooks/use-query-params', () => ({
  useMarketplaceFilters: () => [
    { q: '', tags: [], category: '' },
    mockSetUrlFilters,
  ],
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { plugins: [] },
    isSuccess: true,
  }),
}))

const mockFetchNextPage = vi.fn()
const mockHasNextPage = false
let mockInfiniteQueryData: { pages: Array<{ plugins: unknown[], total: number, page: number, page_size: number }> } | undefined
let capturedInfiniteQueryFn: ((ctx: { pageParam: number, signal: AbortSignal }) => Promise<unknown>) | null = null
let capturedQueryFn: ((ctx: { signal: AbortSignal }) => Promise<unknown>) | null = null
let capturedGetNextPageParam: ((lastPage: { page: number, page_size: number, total: number }) => number | undefined) | null = null

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(({ queryFn, enabled }: { queryFn: (ctx: { signal: AbortSignal }) => Promise<unknown>, enabled: boolean }) => {
    capturedQueryFn = queryFn
    if (queryFn) {
      const controller = new AbortController()
      queryFn({ signal: controller.signal }).catch(() => {})
    }
    return {
      data: enabled ? { marketplaceCollections: [], marketplaceCollectionPluginsMap: {} } : undefined,
      isFetching: false,
      isPending: false,
      isSuccess: enabled,
    }
  }),
  useInfiniteQuery: vi.fn(({ queryFn, getNextPageParam }: {
    queryFn: (ctx: { pageParam: number, signal: AbortSignal }) => Promise<unknown>
    getNextPageParam: (lastPage: { page: number, page_size: number, total: number }) => number | undefined
    enabled: boolean
  }) => {
    capturedInfiniteQueryFn = queryFn
    capturedGetNextPageParam = getNextPageParam
    if (queryFn) {
      const controller = new AbortController()
      queryFn({ pageParam: 1, signal: controller.signal }).catch(() => {})
    }
    if (getNextPageParam) {
      getNextPageParam({ page: 1, page_size: 40, total: 100 })
      getNextPageParam({ page: 3, page_size: 40, total: 100 })
    }
    return {
      data: mockInfiniteQueryData,
      isPending: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: mockHasNextPage,
      fetchNextPage: mockFetchNextPage,
    }
  }),
  useQueryClient: vi.fn(() => ({
    removeQueries: vi.fn(),
  })),
}))

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: unknown[]) => void) => ({
    run: fn,
    cancel: vi.fn(),
  }),
}))

let mockPostMarketplaceShouldFail = false
const mockPostMarketplaceResponse = {
  data: {
    plugins: [
      { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
      { type: 'plugin', org: 'test', name: 'plugin2', tags: [] },
    ],
    bundles: [] as Array<{ type: string, org: string, name: string, tags: unknown[] }>,
    total: 2,
  },
}

vi.mock('@/service/base', () => ({
  postMarketplace: vi.fn(() => {
    if (mockPostMarketplaceShouldFail)
      return Promise.reject(new Error('Mock API error'))
    return Promise.resolve(mockPostMarketplaceResponse)
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

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    collections: vi.fn(async () => ({
      data: {
        collections: [
          {
            name: 'collection-1',
            label: { 'en-US': 'Collection 1' },
            description: { 'en-US': 'Desc' },
            rule: '',
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
            searchable: true,
            search_params: { query: '', sort_by: 'install_count', sort_order: 'DESC' },
          },
        ],
      },
    })),
    collectionPlugins: vi.fn(async () => ({
      data: {
        plugins: [
          { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
        ],
      },
    })),
    searchAdvanced: vi.fn(async () => ({
      data: {
        plugins: [
          { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
        ],
        total: 1,
      },
    })),
  },
}))

// ================================
// useMarketplaceCollectionsAndPlugins Tests
// ================================
describe('useMarketplaceCollectionsAndPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state correctly', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.queryMarketplaceCollectionsAndPlugins).toBeDefined()
    expect(result.current.setMarketplaceCollections).toBeDefined()
    expect(result.current.setMarketplaceCollectionPluginsMap).toBeDefined()
  })

  it('should provide queryMarketplaceCollectionsAndPlugins function', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())
    expect(typeof result.current.queryMarketplaceCollectionsAndPlugins).toBe('function')
  })

  it('should provide setMarketplaceCollections function', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())
    expect(typeof result.current.setMarketplaceCollections).toBe('function')
  })

  it('should provide setMarketplaceCollectionPluginsMap function', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())
    expect(typeof result.current.setMarketplaceCollectionPluginsMap).toBe('function')
  })

  it('should return marketplaceCollections from data or override', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())
    expect(result.current.marketplaceCollections).toBeUndefined()
  })

  it('should return marketplaceCollectionPluginsMap from data or override', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())
    expect(result.current.marketplaceCollectionPluginsMap).toBeUndefined()
  })
})

// ================================
// useMarketplacePluginsByCollectionId Tests
// ================================
describe('useMarketplacePluginsByCollectionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state when collectionId is undefined', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePluginsByCollectionId(undefined))
    expect(result.current.plugins).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isSuccess).toBe(false)
  })

  it('should return isLoading false when collectionId is provided and query completes', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePluginsByCollectionId('test-collection'))
    expect(result.current.isLoading).toBe(false)
  })

  it('should accept query parameter', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('./hooks')
    const { result } = renderHook(() =>
      useMarketplacePluginsByCollectionId('test-collection', {
        category: 'tool',
        type: 'plugin',
      }))
    expect(result.current.plugins).toBeDefined()
  })

  it('should return plugins property from hook', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePluginsByCollectionId('collection-1'))
    expect(result.current.plugins).toBeDefined()
  })
})

// ================================
// useMarketplacePlugins Tests
// ================================
describe('useMarketplacePlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInfiniteQueryData = undefined
  })

  it('should return initial state correctly', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(result.current.plugins).toBeUndefined()
    expect(result.current.total).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isFetchingNextPage).toBe(false)
    expect(result.current.hasNextPage).toBe(false)
    expect(result.current.page).toBe(0)
  })

  it('should provide queryPlugins function', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(typeof result.current.queryPlugins).toBe('function')
  })

  it('should provide queryPluginsWithDebounced function', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(typeof result.current.queryPluginsWithDebounced).toBe('function')
  })

  it('should provide cancelQueryPluginsWithDebounced function', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(typeof result.current.cancelQueryPluginsWithDebounced).toBe('function')
  })

  it('should provide resetPlugins function', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(typeof result.current.resetPlugins).toBe('function')
  })

  it('should provide fetchNextPage function', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(typeof result.current.fetchNextPage).toBe('function')
  })

  it('should handle queryPlugins call without errors', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(() => {
      result.current.queryPlugins({
        query: 'test',
        sort_by: 'install_count',
        sort_order: 'DESC',
        category: 'tool',
        page_size: 20,
      })
    }).not.toThrow()
  })

  it('should handle queryPlugins with bundle type', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(() => {
      result.current.queryPlugins({
        query: 'test',
        type: 'bundle',
        page_size: 40,
      })
    }).not.toThrow()
  })

  it('should handle resetPlugins call', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(() => {
      result.current.resetPlugins()
    }).not.toThrow()
  })

  it('should handle queryPluginsWithDebounced call', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(() => {
      result.current.queryPluginsWithDebounced({
        query: 'debounced search',
        category: 'all',
      })
    }).not.toThrow()
  })

  it('should handle cancelQueryPluginsWithDebounced call', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(() => {
      result.current.cancelQueryPluginsWithDebounced()
    }).not.toThrow()
  })

  it('should return correct page number', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(result.current.page).toBe(0)
  })

  it('should handle queryPlugins with tags', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(() => {
      result.current.queryPlugins({
        query: 'test',
        tags: ['search', 'image'],
        exclude: ['excluded-plugin'],
      })
    }).not.toThrow()
  })
})

// ================================
// Hooks queryFn Coverage Tests
// ================================
describe('Hooks queryFn Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInfiniteQueryData = undefined
    mockPostMarketplaceShouldFail = false
    capturedInfiniteQueryFn = null
    capturedQueryFn = null
  })

  it('should cover queryFn with pages data', async () => {
    mockInfiniteQueryData = {
      pages: [
        { plugins: [{ name: 'plugin1' }], total: 10, page: 1, page_size: 40 },
      ],
    }

    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())

    result.current.queryPlugins({
      query: 'test',
      category: 'tool',
    })

    expect(result.current).toBeDefined()
  })

  it('should expose page and total from infinite query data', async () => {
    mockInfiniteQueryData = {
      pages: [
        { plugins: [{ name: 'plugin1' }, { name: 'plugin2' }], total: 20, page: 1, page_size: 40 },
        { plugins: [{ name: 'plugin3' }], total: 20, page: 2, page_size: 40 },
      ],
    }

    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())

    result.current.queryPlugins({ query: 'search' })
    expect(result.current.page).toBe(2)
  })

  it('should return undefined total when no query is set', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())
    expect(result.current.total).toBeUndefined()
  })

  it('should directly test queryFn execution', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())

    result.current.queryPlugins({
      query: 'direct test',
      category: 'tool',
      sort_by: 'install_count',
      sort_order: 'DESC',
      page_size: 40,
    })

    if (capturedInfiniteQueryFn) {
      const controller = new AbortController()
      const response = await capturedInfiniteQueryFn({ pageParam: 1, signal: controller.signal })
      expect(response).toBeDefined()
    }
  })

  it('should test queryFn with bundle type', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())

    result.current.queryPlugins({
      type: 'bundle',
      query: 'bundle test',
    })

    if (capturedInfiniteQueryFn) {
      const controller = new AbortController()
      const response = await capturedInfiniteQueryFn({ pageParam: 2, signal: controller.signal })
      expect(response).toBeDefined()
    }
  })

  it('should test queryFn error handling', async () => {
    mockPostMarketplaceShouldFail = true

    const { useMarketplacePlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplacePlugins())

    result.current.queryPlugins({ query: 'test that will fail' })

    if (capturedInfiniteQueryFn) {
      const controller = new AbortController()
      const response = await capturedInfiniteQueryFn({ pageParam: 1, signal: controller.signal })
      expect(response).toBeDefined()
      expect(response).toHaveProperty('plugins')
    }

    mockPostMarketplaceShouldFail = false
  })

  it('should test useMarketplaceCollectionsAndPlugins queryFn', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('./hooks')
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins())

    result.current.queryMarketplaceCollectionsAndPlugins({
      condition: 'category=tool',
    })

    if (capturedQueryFn) {
      const controller = new AbortController()
      const response = await capturedQueryFn({ signal: controller.signal })
      expect(response).toBeDefined()
    }
  })

  it('should test getNextPageParam directly', async () => {
    const { useMarketplacePlugins } = await import('./hooks')
    renderHook(() => useMarketplacePlugins())

    if (capturedGetNextPageParam) {
      const nextPage = capturedGetNextPageParam({ page: 1, page_size: 40, total: 100 })
      expect(nextPage).toBe(2)

      const noMorePages = capturedGetNextPageParam({ page: 3, page_size: 40, total: 100 })
      expect(noMorePages).toBeUndefined()

      const atBoundary = capturedGetNextPageParam({ page: 2, page_size: 50, total: 100 })
      expect(atBoundary).toBeUndefined()
    }
  })
})

// ================================
// useMarketplaceContainerScroll Tests
// ================================
describe('useMarketplaceContainerScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should attach scroll event listener to container', async () => {
    const mockCallback = vi.fn()
    const mockContainer = document.createElement('div')
    mockContainer.id = 'marketplace-container'
    document.body.appendChild(mockContainer)

    const addEventListenerSpy = vi.spyOn(mockContainer, 'addEventListener')
    const { useMarketplaceContainerScroll } = await import('./hooks')

    const TestComponent = () => {
      useMarketplaceContainerScroll(mockCallback)
      return null
    }

    render(<TestComponent />)
    expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    document.body.removeChild(mockContainer)
  })

  it('should call callback when scrolled to bottom', async () => {
    const mockCallback = vi.fn()
    const mockContainer = document.createElement('div')
    mockContainer.id = 'scroll-test-container-hooks'
    document.body.appendChild(mockContainer)

    Object.defineProperty(mockContainer, 'scrollTop', { value: 900, writable: true })
    Object.defineProperty(mockContainer, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(mockContainer, 'clientHeight', { value: 100, writable: true })

    const { useMarketplaceContainerScroll } = await import('./hooks')

    const TestComponent = () => {
      useMarketplaceContainerScroll(mockCallback, 'scroll-test-container-hooks')
      return null
    }

    render(<TestComponent />)

    const scrollEvent = new Event('scroll')
    Object.defineProperty(scrollEvent, 'target', { value: mockContainer })
    mockContainer.dispatchEvent(scrollEvent)

    expect(mockCallback).toHaveBeenCalled()
    document.body.removeChild(mockContainer)
  })

  it('should not call callback when scrollTop is 0', async () => {
    const mockCallback = vi.fn()
    const mockContainer = document.createElement('div')
    mockContainer.id = 'scroll-test-container-hooks-2'
    document.body.appendChild(mockContainer)

    Object.defineProperty(mockContainer, 'scrollTop', { value: 0, writable: true })
    Object.defineProperty(mockContainer, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(mockContainer, 'clientHeight', { value: 100, writable: true })

    const { useMarketplaceContainerScroll } = await import('./hooks')

    const TestComponent = () => {
      useMarketplaceContainerScroll(mockCallback, 'scroll-test-container-hooks-2')
      return null
    }

    render(<TestComponent />)

    const scrollEvent = new Event('scroll')
    Object.defineProperty(scrollEvent, 'target', { value: mockContainer })
    mockContainer.dispatchEvent(scrollEvent)

    expect(mockCallback).not.toHaveBeenCalled()
    document.body.removeChild(mockContainer)
  })

  it('should remove event listener on unmount', async () => {
    const mockCallback = vi.fn()
    const mockContainer = document.createElement('div')
    mockContainer.id = 'scroll-unmount-container-hooks'
    document.body.appendChild(mockContainer)

    const removeEventListenerSpy = vi.spyOn(mockContainer, 'removeEventListener')
    const { useMarketplaceContainerScroll } = await import('./hooks')

    const TestComponent = () => {
      useMarketplaceContainerScroll(mockCallback, 'scroll-unmount-container-hooks')
      return null
    }

    const { unmount } = render(<TestComponent />)
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    document.body.removeChild(mockContainer)
  })
})
