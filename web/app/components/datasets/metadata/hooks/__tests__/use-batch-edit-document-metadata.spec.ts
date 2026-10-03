import type { GetDatasetsByDatasetIdDocumentsByDocumentIdResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, renderHook as renderHookWithoutQuery, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import { DataType, UpdateType } from '../../types'
import useBatchEditDocumentMetadata from '../use-batch-edit-document-metadata'

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
  isUpdated?: boolean
  updateType?: UpdateType
}

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const renderHook = (callback: () => ReturnType<typeof useBatchEditDocumentMetadata>) =>
  renderHookWithoutQuery(callback, {
    wrapper: createQueryClientWrapper(createTestQueryClient()),
  })

const mockConsoleCall = vi.hoisted(() => vi.fn())
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockConsoleCall },
}))

// Mock useBatchUpdateDocMetadata
const mockMutateAsync = vi.fn().mockResolvedValue({})
vi.mock('@/service/knowledge/use-metadata', () => ({
  useBatchUpdateDocMetadata: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  const { createI18nextMock } = await import('@/test/i18n-mock')
  return { ...actual, ...createI18nextMock() }
})

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
      doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Value 2' }],
    },
  ]

  const defaultProps = {
    datasetId: 'ds-1',
    docList: mockDocList as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
    onUpdate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleCall.mockReset()
    mockMutateAsync.mockReset().mockResolvedValue({})
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
    it('should show modal when showEditModal is called', async () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      await act(async () => {
        await result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(true)
    })

    it('should hide modal when hideEditModal is called', async () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      await act(async () => {
        await result.current.showEditModal()
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
          docList: docListWithBuiltIn as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      const hasBuiltIn = result.current.originalList.some((item) => item.id === 'built-in')
      expect(hasBuiltIn).toBe(false)
    })

    it('should mark items with multiple values', () => {
      const docListWithDifferentValues: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Value A' }],
        },
        {
          id: 'doc-2',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Value B' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListWithDifferentValues as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      const fieldItem = result.current.originalList.find((item) => item.id === '1')
      expect(fieldItem?.isMultipleValue).toBe(true)
    })

    it('should not mark items with same values as multiple', () => {
      const docListWithSameValues: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Same Value' }],
        },
        {
          id: 'doc-2',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Same Value' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListWithSameValues as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      const fieldItem = result.current.originalList.find((item) => item.id === '1')
      expect(fieldItem?.isMultipleValue).toBe(false)
    })

    it('should skip already marked multiple value items', () => {
      // Three docs with same field but different values
      const docListThreeDocs: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Value A' }],
        },
        {
          id: 'doc-2',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Value B' }],
        },
        {
          id: 'doc-3',
          doc_metadata: [{ id: '1', name: 'field', type: DataType.string, value: 'Value C' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListThreeDocs as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      // Should only have one item for field '1', marked as multiple
      const fieldItems = result.current.originalList.filter((item) => item.id === '1')
      expect(fieldItems.length).toBe(1)
      expect(fieldItems[0]!.isMultipleValue).toBe(true)
    })
  })

  describe('handleSave', () => {
    it('should call mutateAsync with correct data', async () => {
      const onUpdate = vi.fn()
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({ ...defaultProps, onUpdate }),
      )

      await act(async () => {
        await result.current.showEditModal()
      })

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
        await result.current.showEditModal()
      })

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should hide modal after successful save', async () => {
      const { result } = renderHook(() => useBatchEditDocumentMetadata(defaultProps))

      await act(async () => {
        await result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(true)

      await act(async () => {
        await result.current.showEditModal()
      })

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
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Old Value' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
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
        await result.current.showEditModal()
      })

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
          docList: docListSingleDoc as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
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
        await result.current.showEditModal()
      })

      await act(async () => {
        await result.current.handleSave(editedList, [], false)
      })

      expect(mockMutateAsync).toHaveBeenCalled()
    })

    it('should handle added items', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
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
        await result.current.showEditModal()
      })

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
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' }],
        },
        {
          id: 'doc-2',
          doc_metadata: [],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListMissingField as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
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
        await result.current.showEditModal()
      })

      await act(async () => {
        await result.current.handleSave(editedList, [], true)
      })

      // Both documents should have the field after applying to all
      expect(mockMutateAsync).toHaveBeenCalled()
      const callArgs = mockMutateAsync.mock.calls[0]![0]
      expect(callArgs.metadata_list.length).toBe(2)
    })

    it('should not add missing metadata for multiple value items when isApplyToAllSelectDocument is true', async () => {
      // Two docs with different values for same field
      const docListDifferentValues: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Value A' }],
        },
        {
          id: 'doc-2',
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Value B' }],
        },
        {
          id: 'doc-3',
          doc_metadata: [],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListDifferentValues as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
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
        await result.current.showEditModal()
      })

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
          docList: docListSingleDoc as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
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
        await result.current.showEditModal()
      })

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

  describe('cross-page editing sessions', () => {
    const category: DocMetadataItem = {
      id: 'category',
      name: 'category',
      type: DataType.string,
      value: 'Current page',
    }
    const removable: DocMetadataItem = {
      id: 'removable',
      name: 'removable',
      type: DataType.string,
      value: 'Remove me',
    }
    const currentPageOnly: DocMetadataItem = {
      id: 'current-only',
      name: 'current_only',
      type: DataType.number,
      value: 42,
    }
    const otherPageOnly: DocMetadataItem = {
      id: 'other-only',
      name: 'other_only',
      type: DataType.string,
      value: 'Keep me',
    }
    const otherPageDocument: GetDatasetsByDatasetIdDocumentsByDocumentIdResponse = {
      id: 'other-page',
      doc_metadata: [{ ...category, value: 'Other page' }, removable, otherPageOnly],
    }
    const crossPageProps = {
      ...defaultProps,
      docList: [
        {
          id: 'current-page',
          doc_metadata: [category, removable, currentPageOnly],
        },
      ] as Parameters<typeof useBatchEditDocumentMetadata>[0]['docList'],
      selectedDocumentIds: ['other-page', 'current-page'],
    }

    it('waits for the other page before showing mixed values and fields absent from the current page', async () => {
      const pending = createDeferred<GetDatasetsByDatasetIdDocumentsByDocumentIdResponse>()
      mockConsoleCall.mockReturnValueOnce(pending.promise)
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))
      let opening: Promise<void> | void

      act(() => {
        opening = result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()

      await act(async () => {
        pending.resolve(otherPageDocument)
        await opening
      })

      expect(result.current.isShowEditModal).toBe(true)
      expect(result.current.originalList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'category', isMultipleValue: true, value: null }),
          expect.objectContaining(otherPageOnly),
        ]),
      )
    })

    it('updates and removes fields on both pages while preserving untouched metadata per document', async () => {
      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))

      await act(async () => {
        await result.current.showEditModal()
      })

      const editedList = result.current.originalList
        .filter((item) => item.id !== removable.id)
        .map((item) =>
          item.id === category.id
            ? {
                ...item,
                value: 'Updated',
                isMultipleValue: false,
                updateType: UpdateType.changeValue,
              }
            : item,
        )
      const added: DocMetadataItem = {
        id: 'added',
        name: 'added',
        type: DataType.string,
        value: 'New field',
      }

      await act(async () => {
        await result.current.handleSave(editedList, [added], false)
      })

      const operations = mockMutateAsync.mock.calls[0]![0].metadata_list
      expect(operations).toHaveLength(2)
      for (const [documentId, untouched] of [
        ['current-page', currentPageOnly],
        ['other-page', otherPageOnly],
      ] as const) {
        const operation = operations.find(
          (item: { document_id: string }) => item.document_id === documentId,
        )
        expect(operation).toEqual({
          document_id: documentId,
          metadata_list: expect.arrayContaining([
            { ...category, value: 'Updated' },
            untouched,
            added,
          ]),
          partial_update: false,
        })
        expect(operation.metadata_list).toHaveLength(3)
      }
    })

    it('keeps the editor closed after a metadata load failure and allows retrying', async () => {
      mockConsoleCall.mockRejectedValueOnce(new Error('Metadata unavailable'))
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))

      await act(async () => {
        await result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('api.actionFailed')

      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      await act(async () => {
        await result.current.showEditModal()
      })
      expect(result.current.isShowEditModal).toBe(true)
      expect(result.current.originalList).toEqual(
        expect.arrayContaining([expect.objectContaining(otherPageOnly)]),
      )
    })

    it.each([
      { type: 'unsupported', value: 'Unsupported type' },
      { type: DataType.string, value: true },
    ])(
      'rejects unsupported server metadata ($type, $value) without allowing edits',
      async (field) => {
        const response: GetDatasetsByDatasetIdDocumentsByDocumentIdResponse = {
          id: 'other-page',
          doc_metadata: [{ ...otherPageOnly, ...field }],
        }
        mockConsoleCall.mockResolvedValueOnce(response)
        const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))

        await act(async () => {
          await result.current.showEditModal()
        })
        await act(async () => {
          await result.current.handleSave([], [], false)
        })

        expect(result.current.isShowEditModal).toBe(false)
        expect(result.current.isLoadingMetadata).toBe(false)
        expect(mockMutateAsync).not.toHaveBeenCalled()
        expect(toast.error).toHaveBeenCalledExactlyOnceWith('api.actionFailed')
      },
    )

    it('stops queued metadata requests when loading is cancelled without reporting an error', async () => {
      const pending = createDeferred<GetDatasetsByDatasetIdDocumentsByDocumentIdResponse>()
      mockConsoleCall.mockReturnValue(pending.promise)
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...crossPageProps,
          docList: [],
          selectedDocumentIds: ['doc-1', 'doc-2', 'doc-3', 'doc-4', 'doc-5', 'doc-6'],
        }),
      )
      let opening: Promise<void>
      act(() => {
        opening = result.current.showEditModal()
      })
      await waitFor(() => expect(mockConsoleCall).toHaveBeenCalledTimes(4))

      act(() => result.current.hideEditModal())
      await act(async () => {
        pending.resolve(otherPageDocument)
        await opening
      })

      expect(mockConsoleCall).toHaveBeenCalledTimes(4)
      expect(result.current.isShowEditModal).toBe(false)
      expect(result.current.isLoadingMetadata).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('loads fresh metadata when the editing session is reopened', async () => {
      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))

      await act(async () => {
        await result.current.showEditModal()
      })
      expect(result.current.originalList).toEqual(
        expect.arrayContaining([expect.objectContaining(otherPageOnly)]),
      )

      act(() => result.current.hideEditModal())
      mockConsoleCall.mockResolvedValueOnce({
        ...otherPageDocument,
        doc_metadata: [{ ...otherPageOnly, value: 'Changed since closing' }],
      })
      await act(async () => {
        await result.current.showEditModal()
      })

      expect(result.current.originalList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ...otherPageOnly, value: 'Changed since closing' }),
        ]),
      )
    })

    it('does not close a newer editing session when an earlier save finishes', async () => {
      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))
      await act(async () => {
        await result.current.showEditModal()
      })

      const pendingSave = createDeferred<void>()
      mockMutateAsync.mockReturnValueOnce(pendingSave.promise)
      let saving: Promise<void>
      act(() => {
        saving = result.current.handleSave(result.current.originalList, [], false)
      })
      act(() => result.current.hideEditModal())
      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      await act(async () => {
        await result.current.showEditModal()
      })
      expect(result.current.isShowEditModal).toBe(true)

      await act(async () => {
        pendingSave.resolve()
        await saving
      })

      expect(result.current.isShowEditModal).toBe(true)
    })

    it('keeps the editing session open when saving fails', async () => {
      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))
      await act(async () => {
        await result.current.showEditModal()
      })
      const originalList = result.current.originalList
      mockMutateAsync.mockRejectedValueOnce(new Error('Saving failed'))

      await act(async () => {
        await result.current.handleSave(originalList, [], false)
      })

      expect(result.current.isShowEditModal).toBe(true)
      expect(result.current.originalList).toEqual(originalList)
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('actionMsg.modifiedUnsuccessfully')
    })

    it('discards an in-flight editing session when switching datasets', async () => {
      const pending = createDeferred<GetDatasetsByDatasetIdDocumentsByDocumentIdResponse>()
      mockConsoleCall.mockReturnValueOnce(pending.promise)
      let props = crossPageProps
      const { result, rerender } = renderHook(() => useBatchEditDocumentMetadata(props))
      let opening: Promise<void> | void
      act(() => {
        opening = result.current.showEditModal()
      })

      props = { ...crossPageProps, datasetId: 'another-dataset' }
      rerender()
      await act(async () => {
        pending.resolve(otherPageDocument)
        await opening
      })

      props = crossPageProps
      rerender()
      expect(result.current.isShowEditModal).toBe(false)
      expect(result.current.isLoadingMetadata).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('does not revive an old editing session after switching away and back to its dataset', async () => {
      mockConsoleCall.mockResolvedValueOnce(otherPageDocument)
      let props = crossPageProps
      const { result, rerender } = renderHook(() => useBatchEditDocumentMetadata(props))
      await act(async () => {
        await result.current.showEditModal()
      })
      expect(result.current.isShowEditModal).toBe(true)

      props = { ...crossPageProps, datasetId: 'another-dataset' }
      rerender()
      props = crossPageProps
      rerender()

      expect(result.current.isShowEditModal).toBe(false)
      expect(result.current.isLoadingMetadata).toBe(false)
    })

    it('ignores a repeated open action and edits each selected document once', async () => {
      const pending = createDeferred<GetDatasetsByDatasetIdDocumentsByDocumentIdResponse>()
      mockConsoleCall.mockReturnValueOnce(pending.promise)
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...crossPageProps,
          selectedDocumentIds: ['other-page', 'current-page', 'other-page'],
        }),
      )
      let opening: Promise<void>
      await act(async () => {
        opening = result.current.showEditModal()
        await result.current.showEditModal()
      })
      expect(result.current.isShowEditModal).toBe(false)

      await act(async () => {
        pending.resolve(otherPageDocument)
        await opening
      })
      expect(result.current.documentCount).toBe(2)
      expect(mockConsoleCall).toHaveBeenCalledTimes(1)
      await act(async () => {
        await result.current.handleSave(result.current.originalList, [], false)
      })
      expect(mockMutateAsync.mock.calls[0]![0].metadata_list).toHaveLength(2)
    })

    it('does not reopen the editor when a cancelled metadata request finishes', async () => {
      const pending = createDeferred<GetDatasetsByDatasetIdDocumentsByDocumentIdResponse>()
      mockConsoleCall.mockReturnValueOnce(pending.promise)
      const { result } = renderHook(() => useBatchEditDocumentMetadata(crossPageProps))
      let opening: Promise<void> | void

      act(() => {
        opening = result.current.showEditModal()
      })
      await waitFor(() => expect(mockConsoleCall).toHaveBeenCalledOnce())
      act(() => result.current.hideEditModal())
      await act(async () => {
        pending.resolve(otherPageDocument)
        await opening
      })

      expect(result.current.isShowEditModal).toBe(false)
      expect(result.current.isLoadingMetadata).toBe(false)
      expect(toast.error).not.toHaveBeenCalled()
      expect(mockMutateAsync).not.toHaveBeenCalled()
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
        await result.current.showEditModal()
      })

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

    it('does not save selected documents before their editing session is ready', async () => {
      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          selectedDocumentIds: ['doc-1', 'doc-not-in-list'],
        }),
      )

      await act(async () => {
        await result.current.handleSave([], [], false)
      })

      expect(mockMutateAsync).not.toHaveBeenCalled()
    })
  })

  describe('toCleanMetadataItem sanitization', () => {
    it('should strip extra fields (isMultipleValue, updateType, isUpdated) from metadata items sent to backend', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Old Value' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: 'New Value',
          isMultipleValue: true,
          isUpdated: true,
          updateType: UpdateType.changeValue,
        },
      ]

      await act(async () => {
        await result.current.showEditModal()
      })

      await act(async () => {
        await result.current.handleSave(editedList, [], false)
      })

      const callArgs = mockMutateAsync.mock.calls[0]![0]
      const sentItem = callArgs.metadata_list[0].metadata_list[0]

      // Only id, name, type, value should be present
      expect(Object.keys(sentItem).sort()).toEqual(['id', 'name', 'type', 'value'].sort())
      expect(sentItem).not.toHaveProperty('isMultipleValue')
      expect(sentItem).not.toHaveProperty('updateType')
      expect(sentItem).not.toHaveProperty('isUpdated')
    })

    it('should coerce undefined value to null in metadata items sent to backend', async () => {
      const docListSingleDoc: DocListItem[] = [
        {
          id: 'doc-1',
          doc_metadata: [{ id: '1', name: 'field_one', type: DataType.string, value: 'Value' }],
        },
      ]

      const { result } = renderHook(() =>
        useBatchEditDocumentMetadata({
          ...defaultProps,
          docList: docListSingleDoc as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      // Pass an item with value explicitly set to undefined (via cast)
      const editedList: MetadataItemWithEdit[] = [
        {
          id: '1',
          name: 'field_one',
          type: DataType.string,
          value: undefined as unknown as null,
          updateType: UpdateType.changeValue,
        },
      ]

      await act(async () => {
        await result.current.showEditModal()
      })

      await act(async () => {
        await result.current.handleSave(editedList, [], false)
      })

      const callArgs = mockMutateAsync.mock.calls[0]![0]
      const sentItem = callArgs.metadata_list[0].metadata_list[0]

      // value should be null, not undefined
      expect(sentItem.value).toBeNull()
      expect(sentItem.value).not.toBeUndefined()
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
          docList: docListNoMetadata as Parameters<
            typeof useBatchEditDocumentMetadata
          >[0]['docList'],
        }),
      )

      expect(result.current.originalList).toEqual([])
    })
  })
})
