import type { FullDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMetadataEditor } from './use-metadata-editor'

const createMockDocDetail = (overrides: Record<string, unknown> = {}): FullDocumentDetail => ({
  id: 'doc-1',
  position: 1,
  data_source_type: 'upload_file',
  data_source_info: {},
  data_source_detail_dict: {},
  dataset_process_rule_id: 'rule-1',
  batch: 'batch-1',
  name: 'test-document.txt',
  created_from: 'web',
  created_by: 'user-1',
  created_at: Date.now(),
  tokens: 100,
  indexing_status: 'completed',
  error: null,
  enabled: true,
  disabled_at: null,
  disabled_by: null,
  archived: false,
  archived_reason: null,
  archived_by: null,
  archived_at: null,
  updated_at: Date.now(),
  doc_type: 'book',
  doc_metadata: { title: 'Test Book', author: 'Test Author' },
  display_status: 'available',
  word_count: 100,
  hit_count: 10,
  doc_form: 'text_model',
  segment_count: 5,
  ...overrides,
}) as unknown as FullDocumentDetail

describe('useMetadataEditor', () => {
  describe('initial state', () => {
    it('should initialize with edit mode when no doc_type', () => {
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail: undefined }),
      )

      expect(result.current.editStatus).toBe(true)
      expect(result.current.showDocTypes).toBe(true)
      expect(result.current.doc_type).toBe('')
    })

    it('should initialize with view mode when doc_type exists', () => {
      const docDetail = createMockDocDetail({ doc_type: 'book' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      expect(result.current.editStatus).toBe(false)
      expect(result.current.showDocTypes).toBe(false)
      expect(result.current.doc_type).toBe('book')
    })

    it('should treat "others" doc_type as empty string', () => {
      const docDetail = createMockDocDetail({ doc_type: 'others' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      expect(result.current.doc_type).toBe('')
    })

    it('should initialize metadataParams with doc_metadata', () => {
      const docDetail = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'My Book' },
      })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      expect(result.current.metadataParams.documentType).toBe('book')
      expect(result.current.metadataParams.metadata).toEqual({ title: 'My Book' })
    })
  })

  describe('enableEdit', () => {
    it('should set editStatus to true', () => {
      const docDetail = createMockDocDetail({ doc_type: 'book' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      expect(result.current.editStatus).toBe(false)

      act(() => {
        result.current.enableEdit()
      })

      expect(result.current.editStatus).toBe(true)
    })
  })

  describe('confirmDocType', () => {
    it('should not do anything when tempDocType is empty', () => {
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail: undefined }),
      )

      act(() => {
        result.current.confirmDocType()
      })

      expect(result.current.showDocTypes).toBe(true)
    })

    it('should set documentType and close doc type selector', () => {
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail: undefined }),
      )

      act(() => {
        result.current.setTempDocType('book')
      })

      act(() => {
        result.current.confirmDocType()
      })

      expect(result.current.metadataParams.documentType).toBe('book')
      expect(result.current.showDocTypes).toBe(false)
      expect(result.current.editStatus).toBe(true)
    })

    it('should preserve metadata when same doc type is selected', () => {
      const docDetail = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'Existing Title' },
      })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.openDocTypeSelector()
      })

      act(() => {
        result.current.setTempDocType('book')
      })

      act(() => {
        result.current.confirmDocType()
      })

      expect(result.current.metadataParams.metadata).toEqual({ title: 'Existing Title' })
    })

    it('should clear metadata when different doc type is selected', () => {
      const docDetail = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'Existing Title' },
      })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.openDocTypeSelector()
      })

      act(() => {
        result.current.setTempDocType('personal_document')
      })

      act(() => {
        result.current.confirmDocType()
      })

      expect(result.current.metadataParams.documentType).toBe('personal_document')
      expect(result.current.metadataParams.metadata).toEqual({})
    })
  })

  describe('cancelDocType', () => {
    it('should restore tempDocType to current documentType', () => {
      const docDetail = createMockDocDetail({ doc_type: 'book' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.openDocTypeSelector()
      })

      act(() => {
        result.current.setTempDocType('personal_document')
      })

      act(() => {
        result.current.cancelDocType()
      })

      expect(result.current.tempDocType).toBe('book')
      expect(result.current.showDocTypes).toBe(false)
    })
  })

  describe('resetToInitial', () => {
    it('should reset to initial state from docDetail', () => {
      const docDetail = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'Original Title' },
      })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.enableEdit()
      })

      act(() => {
        result.current.updateMetadataField('title', 'Modified Title')
      })

      act(() => {
        result.current.resetToInitial()
      })

      expect(result.current.metadataParams.metadata).toEqual({ title: 'Original Title' })
      expect(result.current.editStatus).toBe(false)
    })

    it('should show doc types when no initial doc_type', () => {
      const docDetail = createMockDocDetail({ doc_type: '' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.setTempDocType('book')
      })

      act(() => {
        result.current.confirmDocType()
      })

      act(() => {
        result.current.resetToInitial()
      })

      expect(result.current.showDocTypes).toBe(true)
    })
  })

  describe('updateMetadataField', () => {
    it('should update a single metadata field', () => {
      const docDetail = createMockDocDetail({ doc_type: 'book' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.updateMetadataField('title', 'New Title')
      })

      expect(result.current.metadataParams.metadata.title).toBe('New Title')
    })

    it('should preserve other metadata fields when updating', () => {
      const docDetail = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'Title', author: 'Author' },
      })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.updateMetadataField('title', 'New Title')
      })

      expect(result.current.metadataParams.metadata).toEqual({
        title: 'New Title',
        author: 'Author',
      })
    })
  })

  describe('openDocTypeSelector', () => {
    it('should set showDocTypes to true', () => {
      const docDetail = createMockDocDetail({ doc_type: 'book' })
      const { result } = renderHook(() =>
        useMetadataEditor({ docDetail }),
      )

      act(() => {
        result.current.enableEdit()
      })

      expect(result.current.showDocTypes).toBe(false)

      act(() => {
        result.current.openDocTypeSelector()
      })

      expect(result.current.showDocTypes).toBe(true)
    })
  })

  describe('effect on docDetail change', () => {
    it('should update state when docDetail changes', () => {
      const initialDoc = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'Initial' },
      })
      const { result, rerender } = renderHook(
        ({ docDetail }) => useMetadataEditor({ docDetail }),
        { initialProps: { docDetail: initialDoc } },
      )

      expect(result.current.metadataParams.metadata).toEqual({ title: 'Initial' })

      const updatedDoc = createMockDocDetail({
        doc_type: 'book',
        doc_metadata: { title: 'Updated' },
      })

      rerender({ docDetail: updatedDoc })

      expect(result.current.metadataParams.metadata).toEqual({ title: 'Updated' })
    })
  })
})
