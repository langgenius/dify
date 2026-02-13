import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SORT } from '../constants'

const createWrapper = (searchParams = '') => {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        {children}
      </NuqsTestingAdapter>
    </JotaiProvider>
  )
  return { wrapper, onUrlUpdate }
}

describe('Marketplace sort atoms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return default sort value from useMarketplaceSort', async () => {
    const { useMarketplaceSort } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceSort(), { wrapper })

    expect(result.current[0]).toEqual(DEFAULT_SORT)
    expect(typeof result.current[1]).toBe('function')
  })

  it('should return default sort value from useMarketplaceSortValue', async () => {
    const { useMarketplaceSortValue } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceSortValue(), { wrapper })

    expect(result.current).toEqual(DEFAULT_SORT)
  })

  it('should return setter from useSetMarketplaceSort', async () => {
    const { useSetMarketplaceSort } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useSetMarketplaceSort(), { wrapper })

    expect(typeof result.current).toBe('function')
  })

  it('should update sort value via useMarketplaceSort setter', async () => {
    const { useMarketplaceSort } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceSort(), { wrapper })

    act(() => {
      result.current[1]({ sortBy: 'created_at', sortOrder: 'ASC' })
    })

    expect(result.current[0]).toEqual({ sortBy: 'created_at', sortOrder: 'ASC' })
  })
})

describe('useSearchPluginText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty string as default', async () => {
    const { useSearchPluginText } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useSearchPluginText(), { wrapper })

    expect(result.current[0]).toBe('')
    expect(typeof result.current[1]).toBe('function')
  })

  it('should parse q from search params', async () => {
    const { useSearchPluginText } = await import('../atoms')
    const { wrapper } = createWrapper('?q=hello')
    const { result } = renderHook(() => useSearchPluginText(), { wrapper })

    expect(result.current[0]).toBe('hello')
  })

  it('should expose a setter function for search text', async () => {
    const { useSearchPluginText } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useSearchPluginText(), { wrapper })

    expect(typeof result.current[1]).toBe('function')

    // Calling the setter should not throw
    await act(async () => {
      result.current[1]('search term')
    })
  })
})

describe('useActivePluginType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return "all" as default category', async () => {
    const { useActivePluginType } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useActivePluginType(), { wrapper })

    expect(result.current[0]).toBe('all')
  })

  it('should parse category from search params', async () => {
    const { useActivePluginType } = await import('../atoms')
    const { wrapper } = createWrapper('?category=tool')
    const { result } = renderHook(() => useActivePluginType(), { wrapper })

    expect(result.current[0]).toBe('tool')
  })
})

describe('useFilterPluginTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty array as default', async () => {
    const { useFilterPluginTags } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useFilterPluginTags(), { wrapper })

    expect(result.current[0]).toEqual([])
  })

  it('should parse tags from search params', async () => {
    const { useFilterPluginTags } = await import('../atoms')
    const { wrapper } = createWrapper('?tags=search')
    const { result } = renderHook(() => useFilterPluginTags(), { wrapper })

    expect(result.current[0]).toEqual(['search'])
  })
})

describe('useMarketplaceSearchMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return false when no search text, no tags, and category has collections (all)', async () => {
    const { useMarketplaceSearchMode } = await import('../atoms')
    const { wrapper } = createWrapper('?category=all')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    // "all" is in PLUGIN_CATEGORY_WITH_COLLECTIONS, so search mode should be false
    expect(result.current).toBe(false)
  })

  it('should return true when search text is present', async () => {
    const { useMarketplaceSearchMode } = await import('../atoms')
    const { wrapper } = createWrapper('?q=test&category=all')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(true)
  })

  it('should return true when tags are present', async () => {
    const { useMarketplaceSearchMode } = await import('../atoms')
    const { wrapper } = createWrapper('?tags=search&category=all')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(true)
  })

  it('should return true when category does not have collections (e.g. model)', async () => {
    const { useMarketplaceSearchMode } = await import('../atoms')
    const { wrapper } = createWrapper('?category=model')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    // "model" is NOT in PLUGIN_CATEGORY_WITH_COLLECTIONS, so search mode = true
    expect(result.current).toBe(true)
  })

  it('should return false when category has collections (tool) and no search/tags', async () => {
    const { useMarketplaceSearchMode } = await import('../atoms')
    const { wrapper } = createWrapper('?category=tool')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(false)
  })
})

describe('useMarketplaceMoreClick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return a callback function', async () => {
    const { useMarketplaceMoreClick } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceMoreClick(), { wrapper })

    expect(typeof result.current).toBe('function')
  })

  it('should do nothing when called with no params', async () => {
    const { useMarketplaceMoreClick } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceMoreClick(), { wrapper })

    // Should not throw when called with undefined
    act(() => {
      result.current(undefined)
    })
  })

  it('should update search state when called with search params', async () => {
    const { useMarketplaceMoreClick, useMarketplaceSortValue } = await import('../atoms')
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => ({
      handleMoreClick: useMarketplaceMoreClick(),
      sort: useMarketplaceSortValue(),
    }), { wrapper })

    act(() => {
      result.current.handleMoreClick({
        query: 'collection search',
        sort_by: 'created_at',
        sort_order: 'ASC',
      })
    })

    // Sort should be updated via the jotai atom
    expect(result.current.sort).toEqual({ sortBy: 'created_at', sortOrder: 'ASC' })
  })

  it('should use defaults when search params fields are missing', async () => {
    const { useMarketplaceMoreClick } = await import('../atoms')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceMoreClick(), { wrapper })

    act(() => {
      result.current({})
    })
  })
})
