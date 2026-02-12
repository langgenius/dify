import type { DocumentListQuery } from '../use-document-list-query-state'
import type { DocumentListResponse } from '@/models/datasets'

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentsPageState } from '../use-documents-page-state'

const mockUpdateQuery = vi.fn()
const mockResetQuery = vi.fn()
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/datasets/test-id/documents',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock ahooks debounce utilities: required because tests capture the debounce
// callback reference to invoke it synchronously, bypassing real timer delays.
let capturedDebounceFnCallback: (() => void) | null = null

vi.mock('ahooks', () => ({
  useDebounce: (value: unknown, _options?: { wait?: number }) => value,
  useDebounceFn: (fn: () => void, _options?: { wait?: number }) => {
    capturedDebounceFnCallback = fn
    return { run: fn, cancel: vi.fn(), flush: vi.fn() }
  },
}))

// Mock the dependent hook
vi.mock('../use-document-list-query-state', () => ({
  default: () => ({
    query: mockQuery,
    updateQuery: mockUpdateQuery,
    resetQuery: mockResetQuery,
  }),
}))

// Factory for creating DocumentListResponse test data
function createDocumentListResponse(overrides: Partial<DocumentListResponse> = {}): DocumentListResponse {
  return {
    data: [],
    has_more: false,
    total: 0,
    page: 1,
    limit: 10,
    ...overrides,
  }
}

// Factory for creating a minimal document item
function createDocumentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test-doc.txt',
    indexing_status: 'completed' as string,
    display_status: 'available' as string,
    enabled: true,
    archived: false,
    word_count: 100,
    created_at: Date.now(),
    updated_at: Date.now(),
    created_from: 'web' as const,
    created_by: 'user-1',
    dataset_process_rule_id: 'rule-1',
    doc_form: 'text_model' as const,
    doc_language: 'en',
    position: 1,
    data_source_type: 'upload_file',
    ...overrides,
  }
}

describe('useDocumentsPageState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedDebounceFnCallback = null
    mockQuery = { page: 1, limit: 10, keyword: '', status: 'all', sort: '-created_at' }
  })

  // Initial state verification
  describe('initial state', () => {
    it('should return correct initial search state', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.inputValue).toBe('')
      expect(result.current.searchValue).toBe('')
      expect(result.current.debouncedSearchValue).toBe('')
    })

    it('should return correct initial filter and sort state', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.statusFilterValue).toBe('all')
      expect(result.current.sortValue).toBe('-created_at')
      expect(result.current.normalizedStatusFilterValue).toBe('all')
    })

    it('should return correct initial pagination state', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      // page is query.page - 1 = 0
      expect(result.current.currPage).toBe(0)
      expect(result.current.limit).toBe(10)
    })

    it('should return correct initial selection state', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.selectedIds).toEqual([])
    })

    it('should return correct initial polling state', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.timerCanRun).toBe(true)
    })

    it('should initialize from query when query has keyword', () => {
      mockQuery = { ...mockQuery, keyword: 'initial search' }

      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.inputValue).toBe('initial search')
      expect(result.current.searchValue).toBe('initial search')
    })

    it('should initialize pagination from query with non-default page', () => {
      mockQuery = { ...mockQuery, page: 3, limit: 25 }

      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.currPage).toBe(2) // page - 1
      expect(result.current.limit).toBe(25)
    })

    it('should initialize status filter from query', () => {
      mockQuery = { ...mockQuery, status: 'error' }

      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.statusFilterValue).toBe('error')
    })

    it('should initialize sort from query', () => {
      mockQuery = { ...mockQuery, sort: 'hit_count' }

      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.sortValue).toBe('hit_count')
    })
  })

  // Handler behaviors
  describe('handleInputChange', () => {
    it('should update input value when called', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleInputChange('new value')
      })

      expect(result.current.inputValue).toBe('new value')
    })

    it('should trigger debounced search callback when called', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      // First call sets inputValue and triggers the debounced fn
      act(() => {
        result.current.handleInputChange('search term')
      })

      // The debounced fn captures inputValue from its render closure.
      // After re-render with new inputValue, calling the captured callback again
      // should reflect the updated state.
      act(() => {
        if (capturedDebounceFnCallback)
          capturedDebounceFnCallback()
      })

      expect(result.current.searchValue).toBe('search term')
    })
  })

  describe('handleStatusFilterChange', () => {
    it('should update status filter value when called with valid status', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('error')
      })

      expect(result.current.statusFilterValue).toBe('error')
    })

    it('should reset page to 0 when status filter changes', () => {
      mockQuery = { ...mockQuery, page: 3 }
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('error')
      })

      expect(result.current.currPage).toBe(0)
    })

    it('should call updateQuery with sanitized status and page 1', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('error')
      })

      expect(mockUpdateQuery).toHaveBeenCalledWith({ status: 'error', page: 1 })
    })

    it('should sanitize invalid status to all', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('invalid')
      })

      expect(result.current.statusFilterValue).toBe('all')
      expect(mockUpdateQuery).toHaveBeenCalledWith({ status: 'all', page: 1 })
    })
  })

  describe('handleStatusFilterClear', () => {
    it('should set status to all and reset page when status is not all', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      // First set a non-all status
      act(() => {
        result.current.handleStatusFilterChange('error')
      })
      vi.clearAllMocks()

      // Then clear
      act(() => {
        result.current.handleStatusFilterClear()
      })

      expect(result.current.statusFilterValue).toBe('all')
      expect(mockUpdateQuery).toHaveBeenCalledWith({ status: 'all', page: 1 })
    })

    it('should not call updateQuery when status is already all', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterClear()
      })

      expect(mockUpdateQuery).not.toHaveBeenCalled()
    })
  })

  describe('handleSortChange', () => {
    it('should update sort value and call updateQuery when value changes', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleSortChange('hit_count')
      })

      expect(result.current.sortValue).toBe('hit_count')
      expect(mockUpdateQuery).toHaveBeenCalledWith({ sort: 'hit_count', page: 1 })
    })

    it('should reset page to 0 when sort changes', () => {
      mockQuery = { ...mockQuery, page: 5 }
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleSortChange('hit_count')
      })

      expect(result.current.currPage).toBe(0)
    })

    it('should not call updateQuery when sort value is same as current', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleSortChange('-created_at')
      })

      expect(mockUpdateQuery).not.toHaveBeenCalled()
    })
  })

  describe('handlePageChange', () => {
    it('should update current page and call updateQuery', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handlePageChange(2)
      })

      expect(result.current.currPage).toBe(2)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ page: 3 }) // newPage + 1
    })

    it('should handle page 0 (first page)', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handlePageChange(0)
      })

      expect(result.current.currPage).toBe(0)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ page: 1 })
    })
  })

  describe('handleLimitChange', () => {
    it('should update limit, reset page to 0, and call updateQuery', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleLimitChange(25)
      })

      expect(result.current.limit).toBe(25)
      expect(result.current.currPage).toBe(0)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ limit: 25, page: 1 })
    })
  })

  // Selection state
  describe('selection state', () => {
    it('should update selectedIds via setSelectedIds', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.setSelectedIds(['doc-1', 'doc-2'])
      })

      expect(result.current.selectedIds).toEqual(['doc-1', 'doc-2'])
    })
  })

  // Polling state management
  describe('updatePollingState', () => {
    it('should not update timer when documentsRes is undefined', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.updatePollingState(undefined)
      })

      // timerCanRun remains true (initial value)
      expect(result.current.timerCanRun).toBe(true)
    })

    it('should not update timer when documentsRes.data is undefined', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.updatePollingState({ data: undefined } as unknown as DocumentListResponse)
      })

      expect(result.current.timerCanRun).toBe(true)
    })

    it('should set timerCanRun to false when all documents are completed and status filter is all', () => {
      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'completed' }),
          createDocumentItem({ indexing_status: 'completed' }),
        ] as DocumentListResponse['data'],
        total: 2,
      })

      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.updatePollingState(response)
      })

      expect(result.current.timerCanRun).toBe(false)
    })

    it('should set timerCanRun to true when some documents are not completed', () => {
      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'completed' }),
          createDocumentItem({ indexing_status: 'indexing' }),
        ] as DocumentListResponse['data'],
        total: 2,
      })

      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.updatePollingState(response)
      })

      expect(result.current.timerCanRun).toBe(true)
    })

    it('should count paused documents as completed for polling purposes', () => {
      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'paused' }),
          createDocumentItem({ indexing_status: 'completed' }),
        ] as DocumentListResponse['data'],
        total: 2,
      })

      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.updatePollingState(response)
      })

      // All docs are "embedded" (completed, paused, error), so hasIncomplete = false
      // statusFilter is 'all', so shouldForcePolling = false
      expect(result.current.timerCanRun).toBe(false)
    })

    it('should count error documents as completed for polling purposes', () => {
      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'error' }),
          createDocumentItem({ indexing_status: 'completed' }),
        ] as DocumentListResponse['data'],
        total: 2,
      })

      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.updatePollingState(response)
      })

      expect(result.current.timerCanRun).toBe(false)
    })

    it('should force polling when status filter is a transient status (queuing)', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      // Set status filter to queuing
      act(() => {
        result.current.handleStatusFilterChange('queuing')
      })

      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'completed' }),
        ] as DocumentListResponse['data'],
        total: 1,
      })

      act(() => {
        result.current.updatePollingState(response)
      })

      // shouldForcePolling = true (queuing is transient), hasIncomplete = false
      // timerCanRun = true || false = true
      expect(result.current.timerCanRun).toBe(true)
    })

    it('should force polling when status filter is indexing', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('indexing')
      })

      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'completed' }),
        ] as DocumentListResponse['data'],
        total: 1,
      })

      act(() => {
        result.current.updatePollingState(response)
      })

      expect(result.current.timerCanRun).toBe(true)
    })

    it('should force polling when status filter is paused', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('paused')
      })

      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'paused' }),
        ] as DocumentListResponse['data'],
        total: 1,
      })

      act(() => {
        result.current.updatePollingState(response)
      })

      expect(result.current.timerCanRun).toBe(true)
    })

    it('should not force polling when status filter is a non-transient status (error)', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('error')
      })

      const response = createDocumentListResponse({
        data: [
          createDocumentItem({ indexing_status: 'error' }),
        ] as DocumentListResponse['data'],
        total: 1,
      })

      act(() => {
        result.current.updatePollingState(response)
      })

      // shouldForcePolling = false (error is not transient), hasIncomplete = false (error is embedded)
      expect(result.current.timerCanRun).toBe(false)
    })

    it('should set timerCanRun to true when data is empty and filter is transient', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('indexing')
      })

      const response = createDocumentListResponse({ data: [] as DocumentListResponse['data'], total: 0 })

      act(() => {
        result.current.updatePollingState(response)
      })

      // shouldForcePolling = true (indexing is transient), hasIncomplete = false (0 !== 0 is false)
      expect(result.current.timerCanRun).toBe(true)
    })
  })

  // Page adjustment
  describe('adjustPageForTotal', () => {
    it('should not adjust page when documentsRes is undefined', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.adjustPageForTotal(undefined)
      })

      expect(result.current.currPage).toBe(0)
    })

    it('should not adjust page when currPage is within total pages', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      const response = createDocumentListResponse({ total: 20 })

      act(() => {
        result.current.adjustPageForTotal(response)
      })

      // currPage is 0, totalPages is 2, so no adjustment needed
      expect(result.current.currPage).toBe(0)
    })

    it('should adjust page to last page when currPage exceeds total pages', () => {
      mockQuery = { ...mockQuery, page: 6 }
      const { result } = renderHook(() => useDocumentsPageState())

      // currPage should be 5 (page - 1)
      expect(result.current.currPage).toBe(5)

      const response = createDocumentListResponse({ total: 30 }) // 30/10 = 3 pages

      act(() => {
        result.current.adjustPageForTotal(response)
      })

      // currPage (5) + 1 > totalPages (3), so adjust to totalPages - 1 = 2
      expect(result.current.currPage).toBe(2)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ page: 3 }) // handlePageChange passes newPage + 1
    })

    it('should adjust page to 0 when total is 0 and currPage > 0', () => {
      mockQuery = { ...mockQuery, page: 3 }
      const { result } = renderHook(() => useDocumentsPageState())

      const response = createDocumentListResponse({ total: 0 })

      act(() => {
        result.current.adjustPageForTotal(response)
      })

      // totalPages = 0, so adjust to max(0 - 1, 0) = 0
      expect(result.current.currPage).toBe(0)
      expect(mockUpdateQuery).toHaveBeenCalledWith({ page: 1 })
    })

    it('should not adjust page when currPage is 0 even if total is 0', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      const response = createDocumentListResponse({ total: 0 })

      act(() => {
        result.current.adjustPageForTotal(response)
      })

      // currPage is 0, condition is currPage > 0 so no adjustment
      expect(mockUpdateQuery).not.toHaveBeenCalled()
    })
  })

  // Normalized status filter value
  describe('normalizedStatusFilterValue', () => {
    it('should return all for default status', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(result.current.normalizedStatusFilterValue).toBe('all')
    })

    it('should normalize enabled to available', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('enabled')
      })

      expect(result.current.normalizedStatusFilterValue).toBe('available')
    })

    it('should return non-aliased status as-is', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      act(() => {
        result.current.handleStatusFilterChange('error')
      })

      expect(result.current.normalizedStatusFilterValue).toBe('error')
    })
  })

  // Return value shape
  describe('return value', () => {
    it('should return all expected properties', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      // Search state
      expect(result.current).toHaveProperty('inputValue')
      expect(result.current).toHaveProperty('searchValue')
      expect(result.current).toHaveProperty('debouncedSearchValue')
      expect(result.current).toHaveProperty('handleInputChange')

      // Filter & sort state
      expect(result.current).toHaveProperty('statusFilterValue')
      expect(result.current).toHaveProperty('sortValue')
      expect(result.current).toHaveProperty('normalizedStatusFilterValue')
      expect(result.current).toHaveProperty('handleStatusFilterChange')
      expect(result.current).toHaveProperty('handleStatusFilterClear')
      expect(result.current).toHaveProperty('handleSortChange')

      // Pagination state
      expect(result.current).toHaveProperty('currPage')
      expect(result.current).toHaveProperty('limit')
      expect(result.current).toHaveProperty('handlePageChange')
      expect(result.current).toHaveProperty('handleLimitChange')

      // Selection state
      expect(result.current).toHaveProperty('selectedIds')
      expect(result.current).toHaveProperty('setSelectedIds')

      // Polling state
      expect(result.current).toHaveProperty('timerCanRun')
      expect(result.current).toHaveProperty('updatePollingState')
      expect(result.current).toHaveProperty('adjustPageForTotal')
    })

    it('should have function types for all handlers', () => {
      const { result } = renderHook(() => useDocumentsPageState())

      expect(typeof result.current.handleInputChange).toBe('function')
      expect(typeof result.current.handleStatusFilterChange).toBe('function')
      expect(typeof result.current.handleStatusFilterClear).toBe('function')
      expect(typeof result.current.handleSortChange).toBe('function')
      expect(typeof result.current.handlePageChange).toBe('function')
      expect(typeof result.current.handleLimitChange).toBe('function')
      expect(typeof result.current.setSelectedIds).toBe('function')
      expect(typeof result.current.updatePollingState).toBe('function')
      expect(typeof result.current.adjustPageForTotal).toBe('function')
    })
  })
})
