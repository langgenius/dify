/**
 * Integration Test: Document Management Flow
 *
 * Tests cross-module interactions: query state (URL-based) → document list sorting →
 * document selection → status filter utilities.
 * Validates the data contract between documents page hooks and list component hooks.
 */

import type { SimpleDocumentDetail } from '@/models/datasets'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import { renderHookWithNuqs } from '@/test/nuqs-testing'

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
const { useDocumentListQueryState } = await import(
  '@/app/components/datasets/documents/hooks/use-document-list-query-state',
)

type LocalDoc = SimpleDocumentDetail & { percent?: number }

const renderQueryStateHook = (searchParams = '') => {
  return renderHookWithNuqs(() => useDocumentListQueryState(), { searchParams })
}

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
      const { result } = renderQueryStateHook()

      expect(result.current.query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })

    it('should update keyword query with replace history', async () => {
      const { result, onUrlUpdate } = renderQueryStateHook()

      act(() => {
        result.current.updateQuery({ keyword: 'test', page: 2 })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.options.history).toBe('replace')
      expect(update.searchParams.get('keyword')).toBe('test')
      expect(update.searchParams.get('page')).toBe('2')
    })

    it('should reset query to defaults', async () => {
      const { result, onUrlUpdate } = renderQueryStateHook()

      act(() => {
        result.current.resetQuery()
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.options.history).toBe('replace')
      expect(update.searchParams.toString()).toBe('')
    })
  })

  describe('Document Sort Integration', () => {
    it('should derive sort field and order from remote sort value', () => {
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-created_at',
        onRemoteSortChange: vi.fn(),
      }))

      expect(result.current.sortField).toBe('created_at')
      expect(result.current.sortOrder).toBe('desc')
    })

    it('should call remote sort change with descending sort for a new field', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-created_at',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort('hit_count')
      })

      expect(onRemoteSortChange).toHaveBeenCalledWith('-hit_count')
    })

    it('should toggle descending to ascending when clicking active field', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-hit_count',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort('hit_count')
      })

      expect(onRemoteSortChange).toHaveBeenCalledWith('hit_count')
    })

    it('should ignore null sort field updates', () => {
      const onRemoteSortChange = vi.fn()
      const { result } = renderHook(() => useDocumentSort({
        remoteSortValue: '-created_at',
        onRemoteSortChange,
      }))

      act(() => {
        result.current.handleSort(null)
      })

      expect(onRemoteSortChange).not.toHaveBeenCalled()
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
      const { result: queryResult } = renderQueryStateHook()
      const { result: sortResult } = renderHook(() => useDocumentSort({
        remoteSortValue: queryResult.current.query.sort,
        onRemoteSortChange: vi.fn(),
      }))
      const { result: selResult } = renderHook(() => useDocumentSelection({
        documents: docs,
        selectedIds: [],
        onSelectedIdChange: vi.fn(),
      }))

      // Query defaults
      expect(queryResult.current.query.sort).toBe('-created_at')
      expect(queryResult.current.query.status).toBe('all')

      // Sort state is derived from URL default sort.
      expect(sortResult.current.sortField).toBe('created_at')
      expect(sortResult.current.sortOrder).toBe('desc')

      // Selection starts empty
      expect(selResult.current.isAllSelected).toBe(false)
    })
  })
})
