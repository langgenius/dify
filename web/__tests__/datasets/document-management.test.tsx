/**
 * Integration Test: Document Management Flow
 *
 * Tests cross-module interactions: query state (URL-based) → document list sorting →
 * document selection → status filter utilities.
 * Validates the data contract between documents page hooks and list component hooks.
 */

import type { SimpleDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/datasets/ds-1/documents',
}))

const { sanitizeStatusValue, normalizeStatusForQuery } = await import(
  '@/app/components/datasets/documents/status-filter',
)

const { useDocumentSort } = await import(
  '@/app/components/datasets/documents/components/document-list/hooks/use-document-sort',
)
const { useDocumentSelection } = await import(
  '@/app/components/datasets/documents/components/document-list/hooks/use-document-selection',
)
const { default: useDocumentListQueryState } = await import(
  '@/app/components/datasets/documents/hooks/use-document-list-query-state',
)

type LocalDoc = SimpleDocumentDetail & { percent?: number }

const createDoc = (overrides?: Partial<LocalDoc>): LocalDoc => ({
  id: `doc-${Math.random().toString(36).slice(2, 8)}`,
  name: 'test-doc.txt',
  word_count: 500,
  hit_count: 10,
  created_at: Date.now() / 1000,
  data_source_type: DataSourceType.FILE,
  display_status: 'available',
  indexing_status: 'completed',
  enabled: true,
  archived: false,
  doc_type: null,
  doc_metadata: null,
  position: 1,
  dataset_process_rule_id: 'rule-1',
  ...overrides,
} as LocalDoc)

describe('Document Management Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Status Filter Utilities', () => {
    it('should sanitize valid status values', () => {
      expect(sanitizeStatusValue('all')).toBe('all')
      expect(sanitizeStatusValue('available')).toBe('available')
      expect(sanitizeStatusValue('error')).toBe('error')
    })

    it('should fallback to "all" for invalid values', () => {
      expect(sanitizeStatusValue(null)).toBe('all')
      expect(sanitizeStatusValue(undefined)).toBe('all')
      expect(sanitizeStatusValue('')).toBe('all')
      expect(sanitizeStatusValue('nonexistent')).toBe('all')
    })

    it('should handle URL aliases', () => {
      // 'active' is aliased to 'available'
      expect(sanitizeStatusValue('active')).toBe('available')
    })

    it('should normalize status for API query', () => {
      expect(normalizeStatusForQuery('all')).toBe('all')
      // 'enabled' normalized to 'available' for query
      expect(normalizeStatusForQuery('enabled')).toBe('available')
    })
  })

  describe('URL-based Query State', () => {
    it('should parse default query from empty URL params', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      expect(result.current.query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })

    it('should update query and push to router', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.updateQuery({ keyword: 'test', page: 2 })
      })

      expect(mockPush).toHaveBeenCalled()
      // The push call should contain the updated query params
      const pushUrl = mockPush.mock.calls[0][0] as string
      expect(pushUrl).toContain('keyword=test')
      expect(pushUrl).toContain('page=2')
    })

    it('should reset query to defaults', () => {
      const { result } = renderHook(() => useDocumentListQueryState())

      act(() => {
        result.current.resetQuery()
      })

      expect(mockPush).toHaveBeenCalled()
      // Default query omits default values from URL
      const pushUrl = mockPush.mock.calls[0][0] as string
      expect(pushUrl).toBe('/datasets/ds-1/documents')
    })
  })

  describe('Document Sort Integration', () => {
    it('should return documents unsorted when no sort field set', () => {
      const docs = [
        createDoc({ id: 'doc-1', name: 'Banana.txt', word_count: 300 }),
        createDoc({ id: 'doc-2', name: 'Apple.txt', word_count: 100 }),
        createDoc({ id: 'doc-3', name: 'Cherry.txt', word_count: 200 }),
      ]

      const { result } = renderHook(() => useDocumentSort({
        documents: docs,
        statusFilterValue: '',
        remoteSortValue: '-created_at',
      }))

      expect(result.current.sortField).toBeNull()
      expect(result.current.sortedDocuments).toHaveLength(3)
    })

    it('should sort by name descending', () => {
      const docs = [
        createDoc({ id: 'doc-1', name: 'Banana.txt' }),
        createDoc({ id: 'doc-2', name: 'Apple.txt' }),
        createDoc({ id: 'doc-3', name: 'Cherry.txt' }),
      ]

      const { result } = renderHook(() => useDocumentSort({
        documents: docs,
        statusFilterValue: '',
        remoteSortValue: '-created_at',
      }))

      act(() => {
        result.current.handleSort('name')
      })

      expect(result.current.sortField).toBe('name')
      expect(result.current.sortOrder).toBe('desc')
      const names = result.current.sortedDocuments.map(d => d.name)
      expect(names).toEqual(['Cherry.txt', 'Banana.txt', 'Apple.txt'])
    })

    it('should toggle sort order on same field click', () => {
      const docs = [createDoc({ id: 'doc-1', name: 'A.txt' }), createDoc({ id: 'doc-2', name: 'B.txt' })]

      const { result } = renderHook(() => useDocumentSort({
        documents: docs,
        statusFilterValue: '',
        remoteSortValue: '-created_at',
      }))

      act(() => result.current.handleSort('name'))
      expect(result.current.sortOrder).toBe('desc')

      act(() => result.current.handleSort('name'))
      expect(result.current.sortOrder).toBe('asc')
    })

    it('should filter by status before sorting', () => {
      const docs = [
        createDoc({ id: 'doc-1', name: 'A.txt', display_status: 'available' }),
        createDoc({ id: 'doc-2', name: 'B.txt', display_status: 'error' }),
        createDoc({ id: 'doc-3', name: 'C.txt', display_status: 'available' }),
      ]

      const { result } = renderHook(() => useDocumentSort({
        documents: docs,
        statusFilterValue: 'available',
        remoteSortValue: '-created_at',
      }))

      // Only 'available' documents should remain
      expect(result.current.sortedDocuments).toHaveLength(2)
      expect(result.current.sortedDocuments.every(d => d.display_status === 'available')).toBe(true)
    })
  })

  describe('Document Selection Integration', () => {
    it('should manage selection state externally', () => {
      const docs = [
        createDoc({ id: 'doc-1' }),
        createDoc({ id: 'doc-2' }),
        createDoc({ id: 'doc-3' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: [],
        onSelectedIdChange,
      }))

      expect(result.current.isAllSelected).toBe(false)
      expect(result.current.isSomeSelected).toBe(false)
    })

    it('should select all documents', () => {
      const docs = [
        createDoc({ id: 'doc-1' }),
        createDoc({ id: 'doc-2' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: [],
        onSelectedIdChange,
      }))

      act(() => {
        result.current.onSelectAll()
      })

      expect(onSelectedIdChange).toHaveBeenCalledWith(
        expect.arrayContaining(['doc-1', 'doc-2']),
      )
    })

    it('should detect all-selected state', () => {
      const docs = [
        createDoc({ id: 'doc-1' }),
        createDoc({ id: 'doc-2' }),
      ]

      const { result } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: ['doc-1', 'doc-2'],
        onSelectedIdChange: vi.fn(),
      }))

      expect(result.current.isAllSelected).toBe(true)
    })

    it('should detect partial selection', () => {
      const docs = [
        createDoc({ id: 'doc-1' }),
        createDoc({ id: 'doc-2' }),
        createDoc({ id: 'doc-3' }),
      ]

      const { result } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: ['doc-1'],
        onSelectedIdChange: vi.fn(),
      }))

      expect(result.current.isSomeSelected).toBe(true)
      expect(result.current.isAllSelected).toBe(false)
    })

    it('should identify downloadable selected documents (FILE type only)', () => {
      const docs = [
        createDoc({ id: 'doc-1', data_source_type: DataSourceType.FILE }),
        createDoc({ id: 'doc-2', data_source_type: DataSourceType.NOTION }),
      ]

      const { result } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: ['doc-1', 'doc-2'],
        onSelectedIdChange: vi.fn(),
      }))

      expect(result.current.downloadableSelectedIds).toEqual(['doc-1'])
    })

    it('should clear selection', () => {
      const onSelectedIdChange = vi.fn()
      const docs = [createDoc({ id: 'doc-1' })]

      const { result } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: ['doc-1'],
        onSelectedIdChange,
      }))

      act(() => {
        result.current.clearSelection()
      })

      expect(onSelectedIdChange).toHaveBeenCalledWith([])
    })
  })

  describe('Cross-Module: Query State → Sort → Selection Pipeline', () => {
    it('should maintain consistent default state across all hooks', () => {
      const docs = [createDoc({ id: 'doc-1' })]
      const { result: queryResult } = renderHook(() => useDocumentListQueryState())
      const { result: sortResult } = renderHook(() => useDocumentSort({
        documents: docs,
        statusFilterValue: queryResult.current.query.status,
        remoteSortValue: queryResult.current.query.sort,
      }))
      const { result: selResult } = renderHook(() => useDocumentSelection({
        documents: sortResult.current.sortedDocuments,
        selectedIds: [],
        onSelectedIdChange: vi.fn(),
      }))

      // Query defaults
      expect(queryResult.current.query.sort).toBe('-created_at')
      expect(queryResult.current.query.status).toBe('all')

      // Sort inherits 'all' status → no filtering applied
      expect(sortResult.current.sortedDocuments).toHaveLength(1)

      // Selection starts empty
      expect(selResult.current.isAllSelected).toBe(false)
    })
  })
})
