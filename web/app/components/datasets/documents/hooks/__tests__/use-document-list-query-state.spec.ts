import type { DocumentListQuery } from '../use-document-list-query-state'
import { act, renderHook } from '@testing-library/react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import useDocumentListQueryState from '../use-document-list-query-state'

const mockPush = vi.fn()
const mockSearchParams = new URLSearchParams()

vi.mock('@/models/datasets', () => ({
  DisplayStatusList: [
    'queuing',
    'indexing',
    'paused',
    'error',
    'available',
    'enabled',
    'disabled',
    'archived',
  ],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/datasets/test-id/documents',
  useSearchParams: () => mockSearchParams,
}))

describe('useDocumentListQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock search params to empty
    for (const key of [...mockSearchParams.keys()])
      mockSearchParams.delete(key)
  })

  // Tests for parseParams (exposed via the query property)
  describe('parseParams (via query)', () => {
    it('should return default query when no search params present', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })

    it('should parse page from search params', () => {
      mockSearchParams.set('page', '3')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.page).toBe(3)
    })

    it('should default page to 1 when page is zero', () => {
      mockSearchParams.set('page', '0')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.page).toBe(1)
    })

    it('should default page to 1 when page is negative', () => {
      mockSearchParams.set('page', '-5')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.page).toBe(1)
    })

    it('should default page to 1 when page is NaN', () => {
      mockSearchParams.set('page', 'abc')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.page).toBe(1)
    })

    it('should parse limit from search params', () => {
      mockSearchParams.set('limit', '50')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.limit).toBe(50)
    })

    it('should default limit to 10 when limit is zero', () => {
      mockSearchParams.set('limit', '0')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.limit).toBe(10)
    })

    it('should default limit to 10 when limit exceeds 100', () => {
      mockSearchParams.set('limit', '101')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.limit).toBe(10)
    })

    it('should default limit to 10 when limit is negative', () => {
      mockSearchParams.set('limit', '-1')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.limit).toBe(10)
    })

    it('should accept limit at boundary 100', () => {
      mockSearchParams.set('limit', '100')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.limit).toBe(100)
    })

    it('should accept limit at boundary 1', () => {
      mockSearchParams.set('limit', '1')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.limit).toBe(1)
    })

    it('should parse and decode keyword from search params', () => {
      mockSearchParams.set('keyword', encodeURIComponent('hello world'))

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.keyword).toBe('hello world')
    })

    it('should return empty keyword when not present', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.keyword).toBe('')
    })

    it('should sanitize status from search params', () => {
      mockSearchParams.set('status', 'available')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.status).toBe('available')
    })

    it('should fallback status to all for unknown status', () => {
      mockSearchParams.set('status', 'badvalue')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.status).toBe('all')
    })

    it('should resolve active status alias to available', () => {
      mockSearchParams.set('status', 'active')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.status).toBe('available')
    })

    it('should parse valid sort value from search params', () => {
      mockSearchParams.set('sort', 'hit_count')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.sort).toBe('hit_count')
    })

    it('should default sort to -created_at for invalid sort value', () => {
      mockSearchParams.set('sort', 'invalid_sort')

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.sort).toBe('-created_at')
    })

    it('should default sort to -created_at when not present', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.sort).toBe('-created_at')
    })

    it.each([
      '-created_at',
      'created_at',
      '-hit_count',
      'hit_count',
    ] as const)('should accept valid sort value %s', (sortValue) => {
      mockSearchParams.set('sort', sortValue)

      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query.sort).toBe(sortValue)
    })
  })

  // Tests for updateQuery
  describe('updateQuery', () => {
    it('should call router.push with updated params when page is changed', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ page: 3 })
      })

      expect(mockPush).toHaveBeenCalledTimes(1)
      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toContain('page=3')
    })

    it('should call router.push with scroll false', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.any(String),
        { scroll: false },
      )
    })

    it('should set status in URL when status is not all', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ status: 'error' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toContain('status=error')
    })

    it('should not set status in URL when status is all', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ status: 'all' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).not.toContain('status=')
    })

    it('should set sort in URL when sort is not the default -created_at', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ sort: 'hit_count' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toContain('sort=hit_count')
    })

    it('should not set sort in URL when sort is default -created_at', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ sort: '-created_at' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).not.toContain('sort=')
    })

    it('should encode keyword in URL when keyword is provided', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ keyword: 'test query' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      // Source code applies encodeURIComponent before setting in URLSearchParams
      expect(pushedUrl).toContain('keyword=')
      const params = new URLSearchParams(pushedUrl.split('?')[1])
      // params.get decodes one layer, but the value was pre-encoded with encodeURIComponent
      expect(decodeURIComponent(params.get('keyword')!)).toBe('test query')
    })

    it('should remove keyword from URL when keyword is empty', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ keyword: '' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).not.toContain('keyword=')
    })

    it('should sanitize invalid status to all and not include in URL', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ status: 'invalidstatus' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).not.toContain('status=')
    })

    it('should sanitize invalid sort to -created_at and not include in URL', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ sort: 'invalidsort' as DocumentListQuery['sort'] })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).not.toContain('sort=')
    })

    it('should omit page and limit when they are default and no keyword', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ page: 1, limit: 10 })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).not.toContain('page=')
      expect(pushedUrl).not.toContain('limit=')
    })

    it('should include page and limit when page is greater than 1', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toContain('page=2')
      expect(pushedUrl).toContain('limit=10')
    })

    it('should include page and limit when limit is non-default', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ limit: 25 })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toContain('page=1')
      expect(pushedUrl).toContain('limit=25')
    })

    it('should include page and limit when keyword is provided', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ keyword: 'search' })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toContain('page=1')
      expect(pushedUrl).toContain('limit=10')
    })

    it('should use pathname prefix in pushed URL', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toMatch(/^\/datasets\/test-id\/documents/)
    })

    it('should push path without query string when all values are defaults', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({})
      })

      const pushedUrl = mockPush.mock.calls[0][0] as string
      expect(pushedUrl).toBe('/datasets/test-id/documents')
    })
  })

  // Tests for resetQuery
  describe('resetQuery', () => {
    it('should push URL with default query params when called', () => {
      mockSearchParams.set('page', '5')
      mockSearchParams.set('status', 'error')

      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.resetQuery()
      })

      expect(mockPush).toHaveBeenCalledTimes(1)
      const pushedUrl = mockPush.mock.calls[0][0] as string
      // Default query has all defaults, so no params should be in the URL
      expect(pushedUrl).toBe('/datasets/test-id/documents')
    })

    it('should call router.push with scroll false when resetting', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.resetQuery()
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.any(String),
        { scroll: false },
      )
    })
  })

  // Tests for return value stability
  describe('return value', () => {
    it('should return query, updateQuery, and resetQuery', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current).toHaveProperty('query')
      expect(result.current).toHaveProperty('updateQuery')
      expect(result.current).toHaveProperty('resetQuery')
      expect(typeof result.current.updateQuery).toBe('function')
      expect(typeof result.current.resetQuery).toBe('function')
    })
  })
})
