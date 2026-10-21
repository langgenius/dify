import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
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
  describe('hasRecoverableDocumentsSelected', () => {
    it('returns false when the selected error document has no server recovery action', () => {
      const docs = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({
          id: 'doc2',
          display_status: 'error',
          enabled: false,
          indexing_retry_action: null,
        }),
      ]

      const { result } = renderHook(() =>
        useDocumentSelection({
          selectedDocuments: docs,
        }),
      )

      expect(result.current.hasRecoverableDocumentsSelected).toBe(false)
    })

    it('returns true when a selected document has a server recovery action', () => {
      const docs = [
        createMockDocument({ id: 'doc1', display_status: 'available' }),
        createMockDocument({
          id: 'doc2',
          display_status: 'error',
          indexing_retry_action: 'enable',
        }),
      ]

      const { result } = renderHook(() =>
        useDocumentSelection({
          selectedDocuments: docs,
        }),
      )

      expect(result.current.hasRecoverableDocumentsSelected).toBe(true)
    })
  })

  describe('downloadableSelectedIds', () => {
    it('should return only FILE type documents from selection', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc3', data_source_type: DataSourceType.FILE }),
      ]
      const { result } = renderHook(() =>
        useDocumentSelection({
          selectedDocuments: docs,
        }),
      )

      expect(result.current.downloadableSelectedIds).toEqual(['doc1', 'doc3'])
    })

    it('should return empty array when no FILE documents selected', () => {
      const docs = [
        createMockDocument({ id: 'doc1', data_source_type: DataSourceType.NOTION }),
        createMockDocument({ id: 'doc2', data_source_type: DataSourceType.WEB }),
      ]
      const { result } = renderHook(() =>
        useDocumentSelection({
          selectedDocuments: docs,
        }),
      )

      expect(result.current.downloadableSelectedIds).toEqual([])
    })
  })
})
