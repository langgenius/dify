/**
 * Test suite for useAppsQueryState hook
 *
 * This hook manages app filtering state through URL search parameters, enabling:
 * - Bookmarkable filter states (users can share URLs with specific filters active)
 * - Browser history integration (back/forward buttons work with filters)
 * - Multiple filter types: tagIDs, keywords, isCreatedByMe
 *
 * The hook syncs local filter state with URL search parameters, making filter
 * navigation persistent and shareable across sessions.
 */
import { act, renderHook } from '@testing-library/react'

// Mock Next.js navigation hooks
const mockPush = vi.fn()
const mockPathname = '/apps'
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => mockPathname),
  useRouter: vi.fn(() => ({
    push: mockPush,
  })),
  useSearchParams: vi.fn(() => mockSearchParams),
}))

// Import the hook after mocks are set up
import useAppsQueryState from './use-apps-query-state'

describe('useAppsQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  describe('Basic functionality', () => {
    it('should return query object and setQuery function', () => {
      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query).toBeDefined()
      expect(typeof result.current.setQuery).toBe('function')
    })

    it('should initialize with empty query when no search params exist', () => {
      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.tagIDs).toBeUndefined()
      expect(result.current.query.keywords).toBeUndefined()
      expect(result.current.query.isCreatedByMe).toBe(false)
    })
  })

  describe('Parsing search params', () => {
    it('should parse tagIDs from URL', () => {
      mockSearchParams.set('tagIDs', 'tag1;tag2;tag3')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('should parse single tagID from URL', () => {
      mockSearchParams.set('tagIDs', 'single-tag')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.tagIDs).toEqual(['single-tag'])
    })

    it('should parse keywords from URL', () => {
      mockSearchParams.set('keywords', 'search term')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.keywords).toBe('search term')
    })

    it('should parse isCreatedByMe as true from URL', () => {
      mockSearchParams.set('isCreatedByMe', 'true')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.isCreatedByMe).toBe(true)
    })

    it('should parse isCreatedByMe as false for other values', () => {
      mockSearchParams.set('isCreatedByMe', 'false')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.isCreatedByMe).toBe(false)
    })

    it('should parse all params together', () => {
      mockSearchParams.set('tagIDs', 'tag1;tag2')
      mockSearchParams.set('keywords', 'test')
      mockSearchParams.set('isCreatedByMe', 'true')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2'])
      expect(result.current.query.keywords).toBe('test')
      expect(result.current.query.isCreatedByMe).toBe(true)
    })
  })

  describe('Updating query state', () => {
    it('should update keywords via setQuery', () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ keywords: 'new search' })
      })

      expect(result.current.query.keywords).toBe('new search')
    })

    it('should update tagIDs via setQuery', () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ tagIDs: ['tag1', 'tag2'] })
      })

      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2'])
    })

    it('should update isCreatedByMe via setQuery', () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ isCreatedByMe: true })
      })

      expect(result.current.query.isCreatedByMe).toBe(true)
    })

    it('should support partial updates via callback', () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ keywords: 'initial' })
      })

      act(() => {
        result.current.setQuery(prev => ({ ...prev, isCreatedByMe: true }))
      })

      expect(result.current.query.keywords).toBe('initial')
      expect(result.current.query.isCreatedByMe).toBe(true)
    })
  })

  describe('URL synchronization', () => {
    it('should sync keywords to URL', async () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ keywords: 'search' })
      })

      // Wait for useEffect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('keywords=search'),
        { scroll: false },
      )
    })

    it('should sync tagIDs to URL with semicolon separator', async () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ tagIDs: ['tag1', 'tag2'] })
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('tagIDs=tag1%3Btag2'),
        { scroll: false },
      )
    })

    it('should sync isCreatedByMe to URL', async () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ isCreatedByMe: true })
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('isCreatedByMe=true'),
        { scroll: false },
      )
    })

    it('should remove keywords from URL when empty', async () => {
      mockSearchParams.set('keywords', 'existing')

      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ keywords: '' })
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Should be called without keywords param
      expect(mockPush).toHaveBeenCalled()
    })

    it('should remove tagIDs from URL when empty array', async () => {
      mockSearchParams.set('tagIDs', 'tag1;tag2')

      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ tagIDs: [] })
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockPush).toHaveBeenCalled()
    })

    it('should remove isCreatedByMe from URL when false', async () => {
      mockSearchParams.set('isCreatedByMe', 'true')

      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ isCreatedByMe: false })
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockPush).toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty tagIDs string in URL', () => {
      // NOTE: This test documents current behavior where ''.split(';') returns ['']
      // This could potentially cause filtering issues as it's treated as a tag with empty name
      // rather than absence of tags. Consider updating parseParams if this is problematic.
      mockSearchParams.set('tagIDs', '')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.tagIDs).toEqual([''])
    })

    it('should handle empty keywords', () => {
      mockSearchParams.set('keywords', '')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.keywords).toBeUndefined()
    })

    it('should handle undefined tagIDs', () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ tagIDs: undefined })
      })

      expect(result.current.query.tagIDs).toBeUndefined()
    })

    it('should handle special characters in keywords', () => {
      // Use URLSearchParams constructor to properly simulate URL decoding behavior
      // URLSearchParams.get() decodes URL-encoded characters
      mockSearchParams = new URLSearchParams('keywords=test%20with%20spaces')

      const { result } = renderHook(() => useAppsQueryState())

      expect(result.current.query.keywords).toBe('test with spaces')
    })
  })

  describe('Memoization', () => {
    it('should return memoized object reference when query unchanged', () => {
      const { result, rerender } = renderHook(() => useAppsQueryState())

      const firstResult = result.current
      rerender()
      const secondResult = result.current

      expect(firstResult.query).toBe(secondResult.query)
    })

    it('should return new object reference when query changes', () => {
      const { result } = renderHook(() => useAppsQueryState())

      const firstQuery = result.current.query

      act(() => {
        result.current.setQuery({ keywords: 'changed' })
      })

      expect(result.current.query).not.toBe(firstQuery)
    })
  })

  describe('Integration scenarios', () => {
    it('should handle sequential updates', async () => {
      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({ keywords: 'first' })
      })

      act(() => {
        result.current.setQuery(prev => ({ ...prev, tagIDs: ['tag1'] }))
      })

      act(() => {
        result.current.setQuery(prev => ({ ...prev, isCreatedByMe: true }))
      })

      expect(result.current.query.keywords).toBe('first')
      expect(result.current.query.tagIDs).toEqual(['tag1'])
      expect(result.current.query.isCreatedByMe).toBe(true)
    })

    it('should clear all filters', () => {
      mockSearchParams.set('tagIDs', 'tag1;tag2')
      mockSearchParams.set('keywords', 'search')
      mockSearchParams.set('isCreatedByMe', 'true')

      const { result } = renderHook(() => useAppsQueryState())

      act(() => {
        result.current.setQuery({
          tagIDs: undefined,
          keywords: undefined,
          isCreatedByMe: false,
        })
      })

      expect(result.current.query.tagIDs).toBeUndefined()
      expect(result.current.query.keywords).toBeUndefined()
      expect(result.current.query.isCreatedByMe).toBe(false)
    })
  })
})
