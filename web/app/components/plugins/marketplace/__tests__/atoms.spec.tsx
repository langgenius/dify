import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import {
  useActivePluginType,
  useFilterPluginTags,
  useMarketplaceMoreClick,
  useMarketplaceSearchMode,
  useMarketplaceSort,
  useMarketplaceSortValue,
  useSearchPluginText,
  useSetMarketplaceSort,
} from '../atoms'
import { DEFAULT_SORT } from '../constants'

const createWrapper = (searchParams = '') => {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ searchParams })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsWrapper>
        {children}
      </NuqsWrapper>
    </JotaiProvider>
  )
  return { wrapper }
}

describe('Marketplace sort atoms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return default sort value from useMarketplaceSort', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceSort(), { wrapper })

    expect(result.current[0]).toEqual(DEFAULT_SORT)
    expect(typeof result.current[1]).toBe('function')
  })

  it('should return default sort value from useMarketplaceSortValue', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceSortValue(), { wrapper })

    expect(result.current).toEqual(DEFAULT_SORT)
  })

  it('should return setter from useSetMarketplaceSort', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => ({
      setSort: useSetMarketplaceSort(),
      sortValue: useMarketplaceSortValue(),
    }), { wrapper })

    act(() => {
      result.current.setSort({ sortBy: 'created_at', sortOrder: 'ASC' })
    })

    expect(result.current.sortValue).toEqual({ sortBy: 'created_at', sortOrder: 'ASC' })
  })

  it('should update sort value via useMarketplaceSort setter', () => {
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

  it('should return empty string as default', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useSearchPluginText(), { wrapper })

    expect(result.current[0]).toBe('')
    expect(typeof result.current[1]).toBe('function')
  })

  it('should parse q from search params', () => {
    const { wrapper } = createWrapper('?q=hello')
    const { result } = renderHook(() => useSearchPluginText(), { wrapper })

    expect(result.current[0]).toBe('hello')
  })

  it('should expose a setter function for search text', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useSearchPluginText(), { wrapper })

    await act(async () => {
      result.current[1]('search term')
    })

    expect(result.current[0]).toBe('search term')
  })
})

describe('useActivePluginType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return "all" as default category', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useActivePluginType(), { wrapper })

    expect(result.current[0]).toBe('all')
  })

  it('should parse category from search params', () => {
    const { wrapper } = createWrapper('?category=tool')
    const { result } = renderHook(() => useActivePluginType(), { wrapper })

    expect(result.current[0]).toBe('tool')
  })
})

describe('useFilterPluginTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty array as default', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useFilterPluginTags(), { wrapper })

    expect(result.current[0]).toEqual([])
  })

  it('should parse tags from search params', () => {
    const { wrapper } = createWrapper('?tags=search')
    const { result } = renderHook(() => useFilterPluginTags(), { wrapper })

    expect(result.current[0]).toEqual(['search'])
  })
})

describe('useMarketplaceSearchMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return false when no search text, no tags, and category has collections (all)', () => {
    const { wrapper } = createWrapper('?category=all')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(false)
  })

  it('should return true when search text is present', () => {
    const { wrapper } = createWrapper('?q=test&category=all')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(true)
  })

  it('should return true when tags are present', () => {
    const { wrapper } = createWrapper('?tags=search&category=all')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(true)
  })

  it('should return true when category does not have collections (e.g. model)', () => {
    const { wrapper } = createWrapper('?category=model')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(true)
  })

  it('should return false when category has collections (tool) and no search/tags', () => {
    const { wrapper } = createWrapper('?category=tool')
    const { result } = renderHook(() => useMarketplaceSearchMode(), { wrapper })

    expect(result.current).toBe(false)
  })
})

describe('useMarketplaceMoreClick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return a callback function', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceMoreClick(), { wrapper })

    expect(typeof result.current).toBe('function')
  })

  it('should do nothing when called with no params', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => ({
      handleMoreClick: useMarketplaceMoreClick(),
      sort: useMarketplaceSortValue(),
      searchText: useSearchPluginText()[0],
    }), { wrapper })

    const sortBefore = result.current.sort
    const searchTextBefore = result.current.searchText

    act(() => {
      result.current.handleMoreClick(undefined)
    })

    expect(result.current.sort).toEqual(sortBefore)
    expect(result.current.searchText).toBe(searchTextBefore)
  })

  it('should update search state when called with search params', () => {
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

    expect(result.current.sort).toEqual({ sortBy: 'created_at', sortOrder: 'ASC' })
  })

  it('should use defaults when search params fields are missing', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => ({
      handleMoreClick: useMarketplaceMoreClick(),
      sort: useMarketplaceSortValue(),
    }), { wrapper })

    act(() => {
      result.current.handleMoreClick({})
    })

    expect(result.current.sort).toEqual(DEFAULT_SORT)
  })
})
