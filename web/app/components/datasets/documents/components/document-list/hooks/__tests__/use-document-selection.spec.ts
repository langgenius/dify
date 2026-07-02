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
  describe('hasErrorDocumentsSelected', () => {
    it('should return false when no error documents are selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({ id: 'doc2', display_status: 'error' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.hasErrorDocumentsSelected).toBe(false)
    })

    it('should return true when an error document is selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({ id: 'doc2', display_status: 'error' }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc2'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.hasErrorDocumentsSelected).toBe(true)
    })
  })

  describe('downloadableSelectedIds', () => {
    it('should return only FILE type documents from selection', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc3', data_source_type: DataSourceType.FILE }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1', 'doc2', 'doc3'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.downloadableSelectedIds).toEqual(['doc1', 'doc3'])
    })

    it('should return empty array when no FILE documents selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.WEB }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1', 'doc2'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.downloadableSelectedIds).toEqual([])
    })
  })

  describe('syncableSelectedDocs', () => {
    it('should return Notion and Website docs from selection', () => {
      const notionDoc = createMockDocument({ id: 'doc1', data_source_type: DataSourceType.NOTION, archived: false })
      const webDoc = createMockDocument({ id: 'doc2', data_source_type: DataSourceType.WEB, archived: false })
      const fileDoc = createMockDocument({ id: 'doc3', data_source_type: DataSourceType.FILE, archived: false })
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: [notionDoc, webDoc, fileDoc],
          selectedIds: ['doc1', 'doc2', 'doc3'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.syncableSelectedDocs).toHaveLength(2)
      expect(result.current.syncableSelectedDocs.map(d => d.id)).toEqual(['doc1', 'doc2'])
    })

    it('should exclude archived documents', () => {
      const archivedNotion = createMockDocument({ id: 'doc1', data_source_type: DataSourceType.NOTION, archived: true })
      const activeNotion = createMockDocument({ id: 'doc2', data_source_type: DataSourceType.NOTION, archived: false })
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: [archivedNotion, activeNotion],
          selectedIds: ['doc1', 'doc2'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.syncableSelectedDocs).toHaveLength(1)
      expect(result.current.syncableSelectedDocs[0].id).toBe('doc2')
    })

    it('should return empty array when only file docs are selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.FILE }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1', 'doc2'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.syncableSelectedDocs).toEqual([])
    })

    it('should only include selected docs (not all syncable docs)', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.WEB }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.syncableSelectedDocs).toHaveLength(1)
      expect(result.current.syncableSelectedDocs[0].id).toBe('doc1')
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
  })
})
