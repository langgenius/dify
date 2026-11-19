import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { DataSourceType } from '@/models/datasets'
import { useDocumentSelection } from '../use-document-selection'

type LocalDoc = DocumentWithSegmentsResponse & { percent?: number }

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
})

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
    it('should include uploaded and pipeline files with download references', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.NOTION }),
        createMockDocument({
          id: 'doc3',
          data_source_type: 'local_file',
          data_source_info: { real_file_id: 'file-3' },
        }),
        createMockDocument({
          id: 'doc4',
          data_source_type: 'local_file',
          data_source_info: { related_id: 'file-4' },
        }),
        createMockDocument({ id: 'doc5', data_source_type: 'local_file', data_source_info: {} }),
      ]
      const onSelectedIdChange = vi.fn()

      const { result } = renderHook(() =>
        useDocumentSelection({
          documents: docs,
          selectedIds: ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'],
          onSelectedIdChange,
        }),
      )

      expect(result.current.downloadableSelectedIds).toEqual(['doc1', 'doc3', 'doc4'])
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
})
