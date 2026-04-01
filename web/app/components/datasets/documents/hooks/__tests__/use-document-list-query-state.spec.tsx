import type { DocumentListQuery } from '../use-document-list-query-state'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { useDocumentListQueryState } from '../use-document-list-query-state'

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

const renderWithAdapter = (searchParams = '') => {
  return renderHookWithNuqs(() => useDocumentListQueryState(), { searchParams })
}

describe('useDocumentListQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('query parsing', () => {
    it('should return default query when no search params present', () => {
      const { result } = renderWithAdapter()

      expect(result.current.query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })

    it('should parse page from search params', () => {
      const { result } = renderWithAdapter('?page=3')
      expect(result.current.query.page).toBe(3)
    })

    it('should default page to 1 when page is zero', () => {
      const { result } = renderWithAdapter('?page=0')
      expect(result.current.query.page).toBe(1)
    })

    it('should default page to 1 when page is negative', () => {
      const { result } = renderWithAdapter('?page=-5')
      expect(result.current.query.page).toBe(1)
    })

    it('should default page to 1 when page is NaN', () => {
      const { result } = renderWithAdapter('?page=abc')
      expect(result.current.query.page).toBe(1)
    })

    it('should parse limit from search params', () => {
      const { result } = renderWithAdapter('?limit=50')
      expect(result.current.query.limit).toBe(50)
    })

    it('should default limit to 10 when limit is zero', () => {
      const { result } = renderWithAdapter('?limit=0')
      expect(result.current.query.limit).toBe(10)
    })

    it('should default limit to 10 when limit exceeds 100', () => {
      const { result } = renderWithAdapter('?limit=101')
      expect(result.current.query.limit).toBe(10)
    })

    it('should default limit to 10 when limit is negative', () => {
      const { result } = renderWithAdapter('?limit=-1')
      expect(result.current.query.limit).toBe(10)
    })

    it('should accept limit at boundary 100', () => {
      const { result } = renderWithAdapter('?limit=100')
      expect(result.current.query.limit).toBe(100)
    })

    it('should accept limit at boundary 1', () => {
      const { result } = renderWithAdapter('?limit=1')
      expect(result.current.query.limit).toBe(1)
    })

    it('should parse keyword from search params', () => {
      const { result } = renderWithAdapter('?keyword=hello+world')
      expect(result.current.query.keyword).toBe('hello world')
    })

    it('should preserve legacy double-encoded keyword text after URL decoding', () => {
      const { result } = renderWithAdapter('?keyword=test%2520query')
      expect(result.current.query.keyword).toBe('test%20query')
    })

    it('should return empty keyword when not present', () => {
      const { result } = renderWithAdapter()
      expect(result.current.query.keyword).toBe('')
    })

    it('should sanitize status from search params', () => {
      const { result } = renderWithAdapter('?status=available')
      expect(result.current.query.status).toBe('available')
    })

    it('should fallback status to all for unknown status', () => {
      const { result } = renderWithAdapter('?status=badvalue')
      expect(result.current.query.status).toBe('all')
    })

    it('should resolve active status alias to available', () => {
      const { result } = renderWithAdapter('?status=active')
      expect(result.current.query.status).toBe('available')
    })

    it('should parse valid sort value from search params', () => {
      const { result } = renderWithAdapter('?sort=hit_count')
      expect(result.current.query.sort).toBe('hit_count')
    })

    it('should default sort to -created_at for invalid sort value', () => {
      const { result } = renderWithAdapter('?sort=invalid_sort')
      expect(result.current.query.sort).toBe('-created_at')
    })

    it('should default sort to -created_at when not present', () => {
      const { result } = renderWithAdapter()
      expect(result.current.query.sort).toBe('-created_at')
    })

    it.each([
      '-created_at',
      'created_at',
      '-hit_count',
      'hit_count',
    ] as const)('should accept valid sort value %s', (sortValue) => {
      const { result } = renderWithAdapter(`?sort=${sortValue}`)
      expect(result.current.query.sort).toBe(sortValue)
    })
  })

  describe('updateQuery', () => {
    it('should update page in state when page is changed', () => {
      const { result } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ page: 3 })
      })

      expect(result.current.query.page).toBe(3)
    })

    it('should sync page to URL with push history', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('page')).toBe('2')
      expect(update.options.history).toBe('push')
    })

    it('should set status in URL when status is not all', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ status: 'error' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('status')).toBe('error')
    })

    it('should not set status in URL when status is all', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ status: 'all' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('status')).toBe(false)
    })

    it('should set sort in URL when sort is not the default -created_at', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ sort: 'hit_count' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('sort')).toBe('hit_count')
    })

    it('should not set sort in URL when sort is default -created_at', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ sort: '-created_at' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('sort')).toBe(false)
    })

    it('should set keyword in URL when keyword is provided', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ keyword: 'test query' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('keyword')).toBe('test query')
      expect(update.options.history).toBe('replace')
    })

    it('should use replace history when keyword update also resets page', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?page=3')

      act(() => {
        result.current.updateQuery({ keyword: 'hello', page: 1 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('keyword')).toBe('hello')
      expect(update.searchParams.has('page')).toBe(false)
      expect(update.options.history).toBe('replace')
    })

    it('should remove keyword from URL when keyword is empty', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?keyword=existing')

      act(() => {
        result.current.updateQuery({ keyword: '' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('keyword')).toBe(false)
      expect(update.options.history).toBe('replace')
    })

    it('should remove keyword from URL when keyword contains only whitespace', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?keyword=existing')

      act(() => {
        result.current.updateQuery({ keyword: '   ' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('keyword')).toBe(false)
      expect(result.current.query.keyword).toBe('')
    })

    it('should preserve literal percent-encoded-like keyword values', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ keyword: '%2F' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('keyword')).toBe('%2F')
      expect(result.current.query.keyword).toBe('%2F')
    })

    it('should keep keyword text unchanged when updating query from legacy URL', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?keyword=test%2520query')

      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      expect(result.current.query.keyword).toBe('test%20query')
    })

    it('should sanitize invalid status to all and not include in URL', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ status: 'invalidstatus' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('status')).toBe(false)
    })

    it('should sanitize invalid sort to -created_at and not include in URL', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ sort: 'invalidsort' as DocumentListQuery['sort'] })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('sort')).toBe(false)
    })

    it('should not include page in URL when page is default', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ page: 1 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('page')).toBe(false)
    })

    it('should include page in URL when page is greater than 1', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('page')).toBe('2')
    })

    it('should include limit in URL when limit is non-default', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ limit: 25 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('limit')).toBe('25')
    })

    it('should sanitize invalid page to default and omit page from URL', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ page: -1 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('page')).toBe(false)
      expect(result.current.query.page).toBe(1)
    })

    it('should sanitize invalid limit to default and omit limit from URL', async () => {
      const { result, onUrlUpdate } = renderWithAdapter()

      act(() => {
        result.current.updateQuery({ limit: 999 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('limit')).toBe(false)
      expect(result.current.query.limit).toBe(10)
    })
  })

  describe('resetQuery', () => {
    it('should reset all values to defaults', () => {
      const { result } = renderWithAdapter('?page=5&status=error&sort=hit_count')

      act(() => {
        result.current.resetQuery()
      })

      expect(result.current.query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })

    it('should clear all params from URL when called', async () => {
      const { result, onUrlUpdate } = renderWithAdapter('?page=5&status=error')

      act(() => {
        result.current.resetQuery()
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('page')).toBe(false)
      expect(update.searchParams.has('status')).toBe(false)
    })
  })

  describe('return value', () => {
    it('should return query, updateQuery, and resetQuery', () => {
      const { result } = renderWithAdapter()

      expect(result.current).toHaveProperty('query')
      expect(result.current).toHaveProperty('updateQuery')
      expect(result.current).toHaveProperty('resetQuery')
      expect(typeof result.current.updateQuery).toBe('function')
      expect(typeof result.current.resetQuery).toBe('function')
    })
  })
})
