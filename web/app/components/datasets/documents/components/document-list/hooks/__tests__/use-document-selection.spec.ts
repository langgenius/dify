import type { SimpleDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import { useDocumentSelection } from '../use-document-selection'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

const createMockDocument = (overrides: Partial<LocalDoc> = {}): LocalDoc => ({
  id: 'doc1',
  name: 'Test Document',
  data_source_type: DataSourceType.FILE,
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

describe('useDocumentSelection', () => {
  describe('hasErrorDocumentsSelected (current-page)', () => {
    it('should return false when no error documents are selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({ id: 'doc2', display_status: 'error' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: [],
          onSelectedIdChange,
        }),
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc1'])
      })

      const { result: rerendered } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1'],
          onSelectedIdChange,
        }),
      )
      act(() => {
        rerendered.current.updateSelectionFromCurrentPage(['doc1'])
      })

      expect(rerendered.current.hasErrorDocumentsSelected).toBe(false)
    })

    it('should return true when an error document is selected on the current page', () => {
      const docs = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({ id: 'doc2', display_status: 'error' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc2'])
      })
      rerender({ selectedIds: ['doc2'] })

      expect(result.current.hasErrorDocumentsSelected).toBe(true)
    })
  })

  describe('downloadableSelectedIds (current-page)', () => {
    it('should include only FILE-type rows the user selected on the current page', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc3', data_source_type: DataSourceType.FILE }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc1', 'doc2', 'doc3'])
      })
      rerender({ selectedIds: ['doc1', 'doc2', 'doc3'] })

      expect(result.current.downloadableSelectedIds).toEqual(['doc1', 'doc3'])
    })

    it('should be empty when only non-FILE rows are selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.WEB }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc1', 'doc2'])
      })
      rerender({ selectedIds: ['doc1', 'doc2'] })

      expect(result.current.downloadableSelectedIds).toEqual([])
    })
  })

  describe('cross-page selection persistence', () => {
    it('keeps hasErrorDocumentsSelected true after navigating away from the page that contained the error doc', () => {
      const page1 = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({ id: 'doc2', display_status: 'error' }),
      ]
      const page2 = [
        createMockDocument({ id: 'doc3', display_status: 'available' }),
        createMockDocument({ id: 'doc4', display_status: 'available' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ docs, selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { docs: page1 as LocalDoc[], selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc2'])
      })
      rerender({ docs: page1 as LocalDoc[], selectedIds: ['doc2'] })
      expect(result.current.hasErrorDocumentsSelected).toBe(true)

      // User paginates to page 2; the error row is no longer in `documents`.
      rerender({ docs: page2 as LocalDoc[], selectedIds: ['doc2'] })
      expect(result.current.hasErrorDocumentsSelected).toBe(true)
    })

    it('keeps off-page FILE selections in downloadableSelectedIds after pagination', () => {
      const page1 = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.NOTION }),
      ]
      const page2 = [
        createMockDocument({ id: 'doc3', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc4', data_source_type: DataSourceType.WEB }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ docs, selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { docs: page1 as LocalDoc[], selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc1'])
      })
      rerender({ docs: page1 as LocalDoc[], selectedIds: ['doc1'] })
      expect(result.current.downloadableSelectedIds).toEqual(['doc1'])

      rerender({ docs: page2 as LocalDoc[], selectedIds: ['doc1'] })
      expect(result.current.downloadableSelectedIds).toEqual(['doc1'])
    })

    it('drops metadata for ids that the next selection no longer contains', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({
          id: 'doc2',
          data_source_type: DataSourceType.NOTION,
          display_status: 'error',
        }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc1', 'doc2'])
      })
      rerender({ selectedIds: ['doc1', 'doc2'] })

      expect(result.current.downloadableSelectedIds).toEqual(['doc1'])
      expect(result.current.hasErrorDocumentsSelected).toBe(true)

      act(() => {
        result.current.updateSelectionFromCurrentPage([])
      })
      rerender({ selectedIds: [] })

      expect(result.current.downloadableSelectedIds).toEqual([])
      expect(result.current.hasErrorDocumentsSelected).toBe(false)
    })
  })

  describe('clearSelection', () => {
    it('should call onSelectedIdChange with empty array', () => {
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: [],
          selectedIds: ['doc1', 'doc2'],
          onSelectedIdChange,
        }),
      )

      act(() => {
        result.current.clearSelection()
      })

      expect(onSelectedIdChange).toHaveBeenCalledWith([])
    })

    it('also drops the remembered selected-doc metadata so a fresh selection starts clean', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result, rerender } = renderHook(
        ({ selectedIds }) =>
          useDocumentSelection({ documents: docs, selectedIds, onSelectedIdChange }),
        { initialProps: { selectedIds: [] as string[] } },
      )

      act(() => {
        result.current.updateSelectionFromCurrentPage(['doc1'])
      })
      rerender({ selectedIds: ['doc1'] })
      expect(result.current.downloadableSelectedIds).toEqual(['doc1'])

      act(() => {
        result.current.clearSelection()
      })
      rerender({ selectedIds: [] })

      expect(result.current.downloadableSelectedIds).toEqual([])
    })
  })
})
