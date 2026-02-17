import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, waitFor } from '@testing-library/react'
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
  return { Wrapper, queryClient }
}

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

describe('useMarketplaceCollectionsAndPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state with all required properties', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins(), { wrapper: Wrapper })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(typeof result.current.queryMarketplaceCollectionsAndPlugins).toBe('function')
    expect(typeof result.current.setMarketplaceCollections).toBe('function')
    expect(typeof result.current.setMarketplaceCollectionPluginsMap).toBe('function')
    expect(result.current.marketplaceCollections).toBeUndefined()
    expect(result.current.marketplaceCollectionPluginsMap).toBeUndefined()
  })
})

describe('useMarketplacePluginsByCollectionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state when collectionId is undefined', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId(undefined),
      { wrapper: Wrapper },
    )
    expect(result.current.plugins).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isSuccess).toBe(false)
  })

  it('should return isLoading false when collectionId is provided and query completes', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('test-collection'),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('should accept query parameter', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('test-collection', {
        category: 'tool',
        type: 'plugin',
      }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should return plugins property from hook', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('collection-1'),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })
})

describe('useMarketplacePlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state correctly', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(result.current.plugins).toBeUndefined()
    expect(result.current.total).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isFetchingNextPage).toBe(false)
    expect(result.current.hasNextPage).toBe(false)
    expect(result.current.page).toBe(0)
  })

  it('should expose all required functions', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(typeof result.current.queryPlugins).toBe('function')
    expect(typeof result.current.queryPluginsWithDebounced).toBe('function')
    expect(typeof result.current.cancelQueryPluginsWithDebounced).toBe('function')
    expect(typeof result.current.resetPlugins).toBe('function')
    expect(typeof result.current.fetchNextPage).toBe('function')
  })

  it('should handle queryPlugins call without errors', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
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
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(() => {
      result.current.queryPlugins({
        query: 'test',
        type: 'bundle',
        page_size: 40,
      })
    }).not.toThrow()
  })

  it('should handle resetPlugins call', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(() => {
      result.current.resetPlugins()
    }).not.toThrow()
  })

  it('should handle queryPluginsWithDebounced call', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    vi.useFakeTimers()
    expect(() => {
      result.current.queryPluginsWithDebounced({
        query: 'debounced search',
        category: 'all',
      })
    }).not.toThrow()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should handle cancelQueryPluginsWithDebounced call', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(() => {
      result.current.cancelQueryPluginsWithDebounced()
    }).not.toThrow()
  })

  it('should return correct page number', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(result.current.page).toBe(0)
  })

  it('should handle queryPlugins with tags', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(() => {
      result.current.queryPlugins({
        query: 'test',
        tags: ['search', 'image'],
        exclude: ['excluded-plugin'],
      })
    }).not.toThrow()
  })
})

describe('Hooks queryFn Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostMarketplaceShouldFail = false
  })

  it('should cover queryFn with pages data', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'test',
      category: 'tool',
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should expose page and total from infinite query data', async () => {
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace)
      .mockResolvedValueOnce({
        data: {
          plugins: [
            { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
            { type: 'plugin', org: 'test', name: 'plugin2', tags: [] },
          ],
          total: 100,
        },
      })
      .mockResolvedValueOnce({
        data: {
          plugins: [{ type: 'plugin', org: 'test', name: 'plugin3', tags: [] }],
          total: 100,
        },
      })

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({ query: 'search', page_size: 40 })
    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
      expect(result.current.page).toBe(1)
      expect(result.current.hasNextPage).toBe(true)
    })

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => {
      expect(result.current.page).toBe(2)
    })
  })

  it('should return undefined total when no query is set', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })
    expect(result.current.total).toBeUndefined()
  })

  it('should directly test queryFn execution', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'direct test',
      category: 'tool',
      sort_by: 'install_count',
      sort_order: 'DESC',
      page_size: 40,
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should test queryFn with bundle type', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      type: 'bundle',
      query: 'bundle test',
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should test queryFn error handling', async () => {
    mockPostMarketplaceShouldFail = true

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({ query: 'test that will fail' })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
    expect(result.current.plugins).toEqual([])
    expect(result.current.total).toBe(0)

    mockPostMarketplaceShouldFail = false
  })

  it('should test useMarketplaceCollectionsAndPlugins queryFn', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins(), { wrapper: Wrapper })

    result.current.queryMarketplaceCollectionsAndPlugins({
      condition: 'category=tool',
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.marketplaceCollections).toBeDefined()
    expect(result.current.marketplaceCollectionPluginsMap).toBeDefined()
  })

  it('should test getNextPageParam via fetchNextPage behavior', async () => {
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace)
      .mockResolvedValueOnce({
        data: { plugins: [], total: 100 },
      })
      .mockResolvedValueOnce({
        data: { plugins: [], total: 100 },
      })
      .mockResolvedValueOnce({
        data: { plugins: [], total: 100 },
      })

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({ query: 'test', page_size: 40 })

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
      expect(result.current.page).toBe(1)
    })

    result.current.fetchNextPage()
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
      expect(result.current.page).toBe(2)
    })

    result.current.fetchNextPage()
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false)
      expect(result.current.page).toBe(3)
    })
  })
})

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
    const { useMarketplaceContainerScroll } = await import('../hooks')

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

    const { useMarketplaceContainerScroll } = await import('../hooks')

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

    const { useMarketplaceContainerScroll } = await import('../hooks')

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
    const { useMarketplaceContainerScroll } = await import('../hooks')

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
