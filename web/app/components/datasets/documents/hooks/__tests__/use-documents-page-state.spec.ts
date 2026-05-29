import type { DocumentListQuery } from '../use-document-list-query-state'

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentsPageState } from '../use-documents-page-state'

const mockUpdateQuery = vi.fn()
let mockQuery: DocumentListQuery = { page: 1, limit: 10, keyword: '', status: 'all', sort: '-created_at' }

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

vi.mock('ahooks', () => ({
  useDebounce: (value: unknown, _options?: { wait?: number }) => value,
}))

vi.mock('../use-document-list-query-state', async () => {
  const React = await import('react')
  return {
    useDocumentListQueryState: () => {
      const [query, setQuery] = React.useState<DocumentListQuery>(mockQuery)
      return {
        query,
        updateQuery: (updates: Partial<DocumentListQuery>) => {
          mockUpdateQuery(updates)
          setQuery(prev => ({ ...prev, ...updates }))
        },
      }
    },
  }
})

describe('useDocumentsPageState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery = { page: 1, limit: 10, keyword: '', status: 'all', sort: '-created_at' }
  })

  // Initial state verification
  describe('initial state', () => {
    it('should return correct initial query-derived state', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.inputValue).toBe('')
      expect(result.current.debouncedSearchValue).toBe('')
      expect(result.current.statusFilterValue).toBe('all')
      expect(result.current.sortValue).toBe('-created_at')
      expect(result.current.normalizedStatusFilterValue).toBe('all')
      expect(result.current.currPage).toBe(0)
      expect(result.current.limit).toBe(10)
      expect(result.current.selectedIds).toEqual([])
    })

    it('should initialize from non-default query values', () => {
      mockQuery = {
        page: 3,
        limit: 25,
        keyword: 'initial',
        status: 'enabled',
        sort: 'hit_count',
      }

      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.inputValue).toBe('initial')
      expect(result.current.currPage).toBe(2)
      expect(result.current.limit).toBe(25)
      expect(result.current.statusFilterValue).toBe('enabled')
      expect(result.current.normalizedStatusFilterValue).toBe('available')
      expect(result.current.sortValue).toBe('hit_count')
    })
  })

  // Handler behaviors
  describe('handleInputChange', () => {
    it('should update keyword and reset page', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleInputChange('new value')
      })

      expect(result.current.inputValue).toBe('new value')
      expect(mockUpdateQuery).toHaveBeenCalledWith({ keyword: 'new value', page: 1 })
    })

    it('should clear selected ids when keyword changes', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.setSelectedIds(['doc-1'])
      })
      expect(result.current.selectedIds).toEqual(['doc-1'])

      act(() => {
        result.current.handleInputChange('keyword')
      })

      expect(result.current.selectedIds).toEqual([])
    })

    it('should keep selected ids when keyword is unchanged', () => {
      mockQuery = { ...mockQuery, keyword: 'same' }
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.setSelectedIds(['doc-1'])
      })

      act(() => {
        result.current.handleInputChange('same')
      })

      expect(result.current.selectedIds).toEqual(['doc-1'])
      expect(mockUpdateQuery).toHaveBeenCalledWith({ keyword: 'same', page: 1 })
    })
  })

  describe('handleStatusFilterChange', () => {
    it('should sanitize status, reset page, and clear selection', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.setSelectedIds(['doc-1'])
      })

      act(() => {
        result.current.handleStatusFilterChange('invalid')
      })

      expect(result.current.statusFilterValue).toBe('all')
      expect(result.current.selectedIds).toEqual([])
      expect(mockUpdateQuery).toHaveBeenCalledWith({ status: 'all', page: 1 })
    })

    it('should update to valid status value', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('error')
      })

      expect(result.current.statusFilterValue).toBe('error')
      expect(mockUpdateQuery).toHaveBeenCalledWith({ status: 'error', page: 1 })
    })
  })

  describe('handleStatusFilterClear', () => {
    it('should reset status to all when status is not all', () => {
      mockQuery = { ...mockQuery, status: 'error' }
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterClear()
      })

      expect(mockUpdateQuery).toHaveBeenCalledWith({ status: 'all', page: 1 })
    })

    it('should do nothing when status is already all', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterClear()
      })

      expect(mockUpdateQuery).not.toHaveBeenCalled()
    })
  })

  describe('handleSortChange', () => {
    it('should update sort and reset page when sort changes', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleSortChange('hit_count')
      })

      expect(result.current.sortValue).toBe('hit_count')
      expect(mockUpdateQuery).toHaveBeenCalledWith({ sort: 'hit_count', page: 1 })
    })

    it('should ignore sort update when value is unchanged', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleSortChange('-created_at')
      })

      expect(mockUpdateQuery).not.toHaveBeenCalled()
    })
  })

  describe('pagination handlers', () => {
    it('should update page with one-based value', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handlePageChange(2)
      })

      expect(result.current.currPage).toBe(2)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ page: 3 })
    })

    it('should update limit and reset page', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleLimitChange(25)
      })

      expect(result.current.limit).toBe(25)
      expect(result.current.currPage).toBe(0)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ limit: 25, page: 1 })
    })
  })

  // Return value shape
  describe('return value', () => {
    it('should return all expected properties', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current).toHaveProperty('inputValue')
      expect(result.current).toHaveProperty('debouncedSearchValue')
      expect(result.current).toHaveProperty('handleInputChange')
      expect(result.current).toHaveProperty('statusFilterValue')
      expect(result.current).toHaveProperty('sortValue')
      expect(result.current).toHaveProperty('normalizedStatusFilterValue')
      expect(result.current).toHaveProperty('handleStatusFilterChange')
      expect(result.current).toHaveProperty('handleStatusFilterClear')
      expect(result.current).toHaveProperty('handleSortChange')
      expect(result.current).toHaveProperty('currPage')
      expect(result.current).toHaveProperty('limit')
      expect(result.current).toHaveProperty('handlePageChange')
      expect(result.current).toHaveProperty('handleLimitChange')
      expect(result.current).toHaveProperty('selectedIds')
      expect(result.current).toHaveProperty('setSelectedIds')
    })

    it('should expose function handlers', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(typeof result.current.handleInputChange).toBe('function')
      expect(typeof result.current.handleStatusFilterChange).toBe('function')
      expect(typeof result.current.handleStatusFilterClear).toBe('function')
      expect(typeof result.current.handleSortChange).toBe('function')
      expect(typeof result.current.handlePageChange).toBe('function')
      expect(typeof result.current.handleLimitChange).toBe('function')
      expect(typeof result.current.setSelectedIds).toBe('function')
    })
  })
})
