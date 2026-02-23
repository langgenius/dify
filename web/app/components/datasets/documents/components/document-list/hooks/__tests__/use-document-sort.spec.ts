import type { SimpleDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDocumentSort } from '../use-document-sort'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

const createMockDocument = (overrides: Partial<LocalDoc> = {}): LocalDoc => ({
  id: 'doc1',
  name: 'Test Document',
  data_source_type: 'upload_file',
  data_source_info: {},
  data_source_detail_dict: {},
  word_count: 100,
  hit_count: 10,
  created_at: 1000000,
  position: 1,
  doc_form: 'text_model',
  enabled: true,
  archived: false,
  display_status: 'available',
  created_from: 'api',
  ...overrides,
} as LocalDoc)

describe('useDocumentSort', () => {
  describe('initial state', () => {
    it('should return null sortField initially', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: [],
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      expect(result.current.sortField).toBeNull()
      expect(result.current.sortOrder).toBe('desc')
    })

    it('should return documents unchanged when no sort is applied', () => {
      const docs = [
        createMockDocument({ id: 'doc1', name: 'B' }),
        createMockDocument({ id: 'doc2', name: 'A' }),
      ]

      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      expect(result.current.sortedDocuments).toEqual(docs)
    })
  })

  describe('handleSort', () => {
    it('should set sort field when called', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: [],
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })

      expect(result.current.sortField).toBe('name')
      expect(result.current.sortOrder).toBe('desc')
    })

    it('should toggle sort order when same field is clicked twice', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: [],
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })
      expect(result.current.sortOrder).toBe('desc')

      act(() => {
        result.current.handleSort('name')
      })
      expect(result.current.sortOrder).toBe('asc')

      act(() => {
        result.current.handleSort('name')
      })
      expect(result.current.sortOrder).toBe('desc')
    })

    it('should reset to desc when different field is selected', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: [],
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })
      act(() => {
        result.current.handleSort('name')
      })
      expect(result.current.sortOrder).toBe('asc')

      act(() => {
        result.current.handleSort('word_count')
      })
      expect(result.current.sortField).toBe('word_count')
      expect(result.current.sortOrder).toBe('desc')
    })

    it('should not change state when null is passed', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: [],
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort(null)
      })

      expect(result.current.sortField).toBeNull()
    })
  })

  describe('sorting documents', () => {
    const docs = [
      createMockDocument({ id: 'doc1', name: 'Banana', word_count: 200, hit_count: 5, created_at: 3000 }),
      createMockDocument({ id: 'doc2', name: 'Apple', word_count: 100, hit_count: 10, created_at: 1000 }),
      createMockDocument({ id: 'doc3', name: 'Cherry', word_count: 300, hit_count: 1, created_at: 2000 }),
    ]

    it('should sort by name descending', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })

      const names = result.current.sortedDocuments.map(d => d.name)
      expect(names).toEqual(['Cherry', 'Banana', 'Apple'])
    })

    it('should sort by name ascending', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })
      act(() => {
        result.current.handleSort('name')
      })

      const names = result.current.sortedDocuments.map(d => d.name)
      expect(names).toEqual(['Apple', 'Banana', 'Cherry'])
    })

    it('should sort by word_count descending', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('word_count')
      })

      const counts = result.current.sortedDocuments.map(d => d.word_count)
      expect(counts).toEqual([300, 200, 100])
    })

    it('should sort by hit_count ascending', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('hit_count')
      })
      act(() => {
        result.current.handleSort('hit_count')
      })

      const counts = result.current.sortedDocuments.map(d => d.hit_count)
      expect(counts).toEqual([1, 5, 10])
    })

    it('should sort by created_at descending', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('created_at')
      })

      const times = result.current.sortedDocuments.map(d => d.created_at)
      expect(times).toEqual([3000, 2000, 1000])
    })
  })

  describe('status filtering', () => {
    const docs = [
      createMockDocument({ id: 'doc1', display_status: 'available' }),
      createMockDocument({ id: 'doc2', display_status: 'error' }),
      createMockDocument({ id: 'doc3', display_status: 'available' }),
    ]

    it('should not filter when statusFilterValue is empty', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      expect(result.current.sortedDocuments.length).toBe(3)
    })

    it('should not filter when statusFilterValue is all', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: 'all',
          remoteSortValue: '',
        }),
      )

      expect(result.current.sortedDocuments.length).toBe(3)
    })
  })

  describe('remoteSortValue reset', () => {
    it('should reset sort state when remoteSortValue changes', () => {
      const { result, rerender } = renderHook(
        ({ remoteSortValue }) =>
          useDocumentSort({
            documents: [],
            statusFilterValue: '',
            remoteSortValue,
          }),
        { initialProps: { remoteSortValue: 'initial' } },
      )

      act(() => {
        result.current.handleSort('name')
      })
      act(() => {
        result.current.handleSort('name')
      })
      expect(result.current.sortField).toBe('name')
      expect(result.current.sortOrder).toBe('asc')

      rerender({ remoteSortValue: 'changed' })

      expect(result.current.sortField).toBeNull()
      expect(result.current.sortOrder).toBe('desc')
    })
  })

  describe('edge cases', () => {
    it('should handle documents with missing values', () => {
      const docs = [
        createMockDocument({ id: 'doc1', name: undefined as unknown as string, word_count: undefined }),
        createMockDocument({ id: 'doc2', name: 'Test', word_count: 100 }),
      ]

      const { result } = renderHook(() =>
        useDocumentSort({
          documents: docs,
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })

      expect(result.current.sortedDocuments.length).toBe(2)
    })

    it('should handle empty documents array', () => {
      const { result } = renderHook(() =>
        useDocumentSort({
          documents: [],
          statusFilterValue: '',
          remoteSortValue: '',
        }),
      )

      act(() => {
        result.current.handleSort('name')
      })

      expect(result.current.sortedDocuments).toEqual([])
    })
  })
})
