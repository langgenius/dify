import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType, UpdateType } from '../types'
import useBatchEditDocumentMetadata from './use-batch-edit-document-metadata'

type DocMetadataItem = {
  id: string
  name: string
  type: DataType
  value: string | number | null
}

type DocListItem = {
  id: string
  name?: string
  doc_metadata?: DocMetadataItem[] | null
}

type MetadataItemWithEdit = {
  id: string
  name: string
  type: DataType
  value: string | number | null
  isMultipleValue?: boolean
  updateType?: UpdateType
}

// Mock useBatchUpdateDocMetadata
const mockMutateAsync = vi.fn().mockResolvedValue({})
vi.mock('@/service/knowledge/use-metadata', () => ({
  useBatchUpdateDocMetadata: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

describe('useBatchEditDocumentMetadata', () => {
  const mockDocList: DocListItem[] = [
    {
      id: 'doc-1',
      name: 'Document 1',
      doc_metadata: [
        { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
        { id: '2', name: 'field_two', type: DataType.number, value: 42 },
      ],
    },
    {
      id: 'doc-2',
      name: 'Document 2',
      doc_metadata: [
        { id: '1', name: 'field_one', type: DataType.string, value: 'Value 2' },
      ],
    },
  ]

  const defaultProps = {
    datasetId: 'ds-1',
    docList: mockDocList as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
    onUpdate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Hook Initialization', () => {
    it('should initialize with isShowEditModal as false', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))
      expect(result.current.isShowEditModal).toBe(false)
    })

    it('should return showEditModal function', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))
      expect(typeof result.current.showEditModal).toBe('function')
    })

    it('should return hideEditModal function', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))
      expect(typeof result.current.hideEditModal).toBe('function')
    })

    it('should return originalList', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))
      expect(Array.isArray(result.current.originalList)).toBe(true)
    })

    it('should return handleSave function', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))
      expect(typeof result.current.handleSave).toBe('function')
    })
  })

  describe('Modal Control', () => {
    it('should show modal when showEditModal is called', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      act(() => {
        result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(true)
    })

    it('should hide modal when hideEditModal is called', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      act(() => {
        result.current.showEditModal()
      })

      act(() => {
        result.current.hideEditModal()
      })

      expect(result.current.isShowEditModal).toBe(false)
    })
  })

  describe('Original List Processing', () => {
    it('should compute originalList from docList metadata', () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      expect(result.current.originalList.length).toBeGreaterThan(0)
    })

    it('should filter out built-in metadata', () => {
      const docListWithBuiltIn: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: 'built-in', name: 'created_at', type: DataType.time, value: 123 },
            { id: '1', name: 'custom', type: DataType.string, value: 'test' },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListWithBuiltIn as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      const hasBuiltIn = result.current.originalList.some(item => item.id === 'built-in')
      expect(hasBuiltIn).toBe(false)
    })

    it('should mark items with multiple values', () => {
      const docListWithDifferentValues: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Value A' },
          ],
        },
        {
          id: 'doc-2',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Value B' },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListWithDifferentValues as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      const fieldItem = result.current.originalList.find(item => item.id === '1')
      expect(fieldItem?.isMultipleValue).toBe(true)
    })

    it('should not mark items with same values as multiple', () => {
      const docListWithSameValues: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Same Value' },
          ],
        },
        {
          id: 'doc-2',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Same Value' },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListWithSameValues as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      const fieldItem = result.current.originalList.find(item => item.id === '1')
      expect(fieldItem?.isMultipleValue).toBe(false)
    })

    it('should skip already marked multiple value items', () => {
      // Three docs with same field but different values
      const docListThreeDocs: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Value A' },
          ],
        },
        {
          id: 'doc-2',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Value B' },
          ],
        },
        {
          id: 'doc-3',
          doc_metadata: [
            { id: '1', name: 'field', type: DataType.string, value: 'Value C' },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListThreeDocs as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      // Should only have one item for field '1', marked as multiple
      const fieldItems = result.current.originalList.filter(item => item.id === '1')
      expect(fieldItems.length).toBe(1)
      expect(fieldItems[0].isMultipleValue).toBe(true)
    })
  })

  describe('handleSave', () => {
    it('should call mutateAsync with correct data', async () => {
      const onUpdate = vi.fn()
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({ ...defaultProps, onUpdate }),
      )

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalled()
    })

    it('should call onUpdate after successful save', async () => {
      const onUpdate = vi.fn()
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({ ...defaultProps, onUpdate }),
      )

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should hide modal after successful save', async () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      act(() => {
        result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(true)

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      await waitFor(() => {
        expect(result.current.isShowEditModal).toBe(false)
      })
    })

    it('should handle edited items with changeValue updateType', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Old Value' },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: 'New Value',
          updateType: UpdateType.changeValue,
        },
      ]

      await act(async () => {
        await result.current.handleSave(editedList, [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_list: expect.arrayContaining([
            expect.objectContaining({
              document_id: 'doc-1',
              metadata_list: expect.arrayContaining([
                expect.objectContaining({
                  id: '1',
                  value: 'New Value',
                }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should handle removed items', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
            { id: '2', name: 'field_two', type: DataType.number, value: 42 },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      // Only pass field_one in editedList, field_two should be removed
      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: 'Value 1',
        },
      ]

      await act(async () => {
        await result.current.handleSave(editedList, [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalled()
    })

    it('should handle added items', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      const addedList = [
        {
          id: 'new-1',
          name: 'new_field',
          type: DataType.string,
          value: 'New Value',
          isMultipleValue: false,
        },
      ]

      await act(async () => {
        await result.current.handleSave([], addedList, false)
      })

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_list: expect.arrayContaining([
            expect.objectContaining({
              metadata_list: expect.arrayContaining([
                expect.objectContaining({
                  name: 'new_field',
                }),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should add missing metadata when isApplyToAllSelectDocument is true', async () => {
      // Doc 1 has field, Doc 2 doesn't have it
      const docListMissingField: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
          ],
        },
        {
          id: 'doc-2',
          doc_metadata: [],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListMissingField as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: 'Updated Value',
          isMultipleValue: false,
          updateType: UpdateType.changeValue,
        },
      ]

      await act(async () => {
        await result.current.handleSave(editedList, [], true)
      })

      // Both documents should have the field after applying to all
      expect(mockMutateAsync).toHaveBeenCalled()
      const callArgs = mockMutateAsync.mock.calls[0][0]
      expect(callArgs.metadata_list.length).toBe(2)
    })

    it('should not add missing metadata for multiple value items when isApplyToAllSelectDocument is true', async () => {
      // Two docs with different values for same field
      const docListDifferentValues: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Value A' },
          ],
        },
        {
          id: 'doc-2',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Value B' },
          ],
        },
        {
          id: 'doc-3',
          doc_metadata: [],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListDifferentValues as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      // Mark it as multiple value item - should not be added to doc-3
      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: null,
          isMultipleValue: true,
          updateType: UpdateType.changeValue,
        },
      ]

      await act(async () => {
        await result.current.handleSave(editedList, [], true)
      })

      expect(mockMutateAsync).toHaveBeenCalled()
    })

    it('should update existing items in the list', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [
            { id: '1', name: 'field_one', type: DataType.string, value: 'Old Value' },
            { id: '2', name: 'field_two', type: DataType.number, value: 100 },
          ],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      // Edit both items
      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: 'New Value 1',
          updateType: UpdateType.changeValue,
        },
        {
          id: '2',
          name: 'field_two',
          type: DataType.number,
          value: 200,
          updateType: UpdateType.changeValue,
        },
      ]

      await act(async () => {
        await result.current.handleSave(editedList, [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_list: expect.arrayContaining([
            expect.objectContaining({
              metadata_list: expect.arrayContaining([
                expect.objectContaining({ id: '1', value: 'New Value 1' }),
                expect.objectContaining({ id: '2', value: 200 }),
              ]),
            }),
          ]),
        }),
      )
    })
  })

  describe('Selected Document IDs', () => {
    it('should use selectedDocumentIds when provided', async () => {
      const selectedIds = ['doc-1']
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          selectedDocumentIds: selectedIds,
        }),
      )

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          dataset_id: 'ds-1',
          metadata_list: expect.arrayContaining([
            expect.objectContaining({
              document_id: 'doc-1',
            }),
          ]),
        }),
      )
    })

    it('should handle selectedDocumentIds not in docList', async () => {
      // Select a document that's not in docList
      const selectedIds = ['doc-1', 'doc-not-in-list']
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          selectedDocumentIds: selectedIds,
        }),
      )

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_list: expect.arrayContaining([
            expect.objectContaining({
              document_id: 'doc-not-in-list',
              partial_update: true,
            }),
          ]),
        }),
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty docList', () => {
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: [] as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      expect(result.current.originalList).toEqual([])
    })

    it('should handle documents without metadata', () => {
      const docListNoMetadata: DocListItem[] = [
        { id: 'doc-1', name: 'Doc 1' },
        { id: 'doc-2', name: 'Doc 2', doc_metadata: null },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListNoMetadata as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
        }),
      )

      expect(result.current.originalList).toEqual([])
    })
  })
})
