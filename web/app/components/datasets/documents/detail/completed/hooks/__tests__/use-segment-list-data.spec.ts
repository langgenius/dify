import type {
  ConsoleSegmentListResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { ChunkingMode, ParentMode } from '@/models/datasets'
import type { SegmentImportStatus } from '@/types/dataset'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ChunkingMode as ChunkingModeEnum } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { segmentImportStatus } from '@/types/dataset'
import { useSegmentListData } from '../use-segment-list-data'

// Mock file entity factory
const createMockFileEntity = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'test.png',
  size: 1024,
  extension: 'png',
  mimeType: 'image/png',
  progress: 100,
  uploadedId: undefined,
  base64Url: undefined,
  ...overrides,
})

// Hoisted Mocks

const {
  mockDocForm,
  mockParentMode,
  mockDatasetId,
  mockDocumentId,
  mockNotify,
  mockEventEmitter,
  getSegments,
  mockSegmentListData,
  mockEnableSegment,
  mockDisableSegment,
  mockDeleteSegment,
  mockUpdateSegment,
  mockPathname,
} = vi.hoisted(() => ({
  mockDocForm: { current: 'text' as ChunkingMode },
  mockParentMode: { current: 'paragraph' as ParentMode },
  mockDatasetId: { current: 'test-dataset-id' },
  mockDocumentId: { current: 'test-document-id' },
  mockNotify: vi.fn(),
  mockEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  getSegments: vi.fn(),
  mockSegmentListData: {
    current: {
      data: [] as SegmentResponse[],
      total: 0,
      total_pages: 0,
      limit: 20,
      page: 1,
    } as ConsoleSegmentListResponse | undefined,
  },
  mockEnableSegment: vi.fn(),
  mockDisableSegment: vi.fn(),
  mockDeleteSegment: vi.fn(),
  mockUpdateSegment: vi.fn(),
  mockPathname: { current: '/datasets/test/documents/test' },
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname.current,
}))

vi.mock('../../../context', () => ({
  useDocumentContext: (selector: (value: DocumentContextValue) => unknown) => {
    const value: DocumentContextValue = {
      datasetId: mockDatasetId.current,
      documentId: mockDocumentId.current,
      docForm: mockDocForm.current,
      parentMode: mockParentMode.current,
    }
    return selector(value)
  },
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

const segmentListsKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.key({
  input: { params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' } },
})

let queryClient = createConsoleQueryClient()
let mockQueryClient = { invalidateQueries: vi.spyOn(queryClient, 'invalidateQueries') }

const expectSegmentListsRefetched = () =>
  expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: segmentListsKey })

const expectOtherStatusListsMarkedStale = () =>
  expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
    queryKey: segmentListsKey,
    refetchType: 'none',
  })

const createWrapper = () => {
  queryClient.setQueryDefaults(segmentListsKey, { initialData: mockSegmentListData.current })
  return createConsoleQueryWrapper({ queryClient }).wrapper
}
const currentKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.queryKey({
  input: {
    params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
    query: { page: 1, limit: 10, keyword: '', enabled: 'all' },
  },
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.segments.get': getSegments,
      'datasets.byDatasetId.documents.byDocumentId.segment.byAction.patch': (input: {
        params: { action: string }
      }) =>
        input.params.action === 'enable' ? mockEnableSegment(input) : mockDisableSegment(input),
      'datasets.byDatasetId.documents.byDocumentId.segments.delete': mockDeleteSegment,
      'datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.patch': mockUpdateSegment,
    }),
  }
})

const createMockSegment = (overrides: Partial<SegmentResponse> = {}): SegmentResponse => ({
  id: 'seg-1',
  position: 1,
  document_id: 'doc-1',
  content: 'Test content',
  sign_content: 'Test signed content',
  word_count: 100,
  tokens: 50,
  keywords: [],
  index_node_id: 'index-1',
  index_node_hash: 'hash-1',
  hit_count: 0,
  enabled: true,
  disabled_at: 0,
  disabled_by: '',
  status: 'completed',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_at: 1700000100,
  completed_at: 1700000200,
  error: null,
  stopped_at: 0,
  answer: null,
  summary: null,
  updated_by: null,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [],
  ...overrides,
})

const defaultOptions = {
  searchValue: '',
  selectedStatus: 'all' as boolean | 'all',
  selectedSegmentIds: [] as string[],
  importStatus: undefined as SegmentImportStatus | undefined,
  currentPage: 1,
  limit: 10,
  onCloseSegmentDetailIfCurrent: vi.fn(),
  clearSelection: vi.fn(),
}

// Tests

describe('useSegmentListData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createConsoleQueryClient()
    mockQueryClient = { invalidateQueries: vi.spyOn(queryClient, 'invalidateQueries') }
    getSegments.mockReset().mockImplementation(() => new Promise(() => {}))
    mockEnableSegment.mockReset().mockResolvedValue({ result: 'success' })
    mockDisableSegment.mockReset().mockResolvedValue({ result: 'success' })
    mockDeleteSegment.mockReset().mockResolvedValue({ result: 'success' })
    mockUpdateSegment.mockReset().mockResolvedValue({ data: createMockSegment() })
    mockDocForm.current = ChunkingModeEnum.text as ChunkingMode
    mockParentMode.current = 'paragraph'
    mockDatasetId.current = 'test-dataset-id'
    mockDocumentId.current = 'test-document-id'
    mockSegmentListData.current = {
      data: [],
      total: 0,
      total_pages: 0,
      limit: 20,
      page: 1,
    }
    mockPathname.current = '/datasets/test/documents/test'
  })

  describe('totalText computation', () => {
    it('should show chunks count when not searching', () => {
      mockSegmentListData.current = {
        data: [],
        total: 10,
        total_pages: 1,
        limit: 20,
        page: 1,
      }

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('10')
      expect(result.current.totalText).toContain('datasetDocuments.segment.chunks')
    })

    it('should show search results when searching', () => {
      mockSegmentListData.current = {
        data: [],
        total: 5,
        total_pages: 1,
        limit: 20,
        page: 1,
      }

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            searchValue: 'test',
          }),
        {
          wrapper: createWrapper(),
        },
      )

      expect(result.current.totalText).toContain('5')
      expect(result.current.totalText).toContain('datasetDocuments.segment.searchResults')
    })

    it('should show search results when status is filtered', () => {
      mockSegmentListData.current = {
        data: [],
        total: 3,
        total_pages: 1,
        limit: 20,
        page: 1,
      }

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            selectedStatus: true,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      expect(result.current.totalText).toContain('datasetDocuments.segment.searchResults')
    })

    it('should show parent chunks in parentChild paragraph mode', () => {
      mockDocForm.current = ChunkingModeEnum.parentChild
      mockParentMode.current = 'paragraph'
      mockSegmentListData.current = {
        data: [],
        total: 7,
        total_pages: 1,
        limit: 20,
        page: 1,
      }

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('datasetDocuments.segment.parentChunks')
    })

    it('should show "--" when total is undefined', () => {
      mockSegmentListData.current = undefined

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('--')
    })
  })

  describe('resetList', () => {
    it('should call clearSelection and invalidSegmentList', () => {
      const clearSelection = vi.fn()

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            clearSelection,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      act(() => {
        result.current.resetList()
      })

      expect(clearSelection).toHaveBeenCalled()
      expectSegmentListsRefetched()
    })
  })

  describe('refreshChunkListWithStatusChanged', () => {
    it('should invalidate segment list when status is not all', async () => {
      mockEnableSegment.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            selectedStatus: true,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      mockQueryClient.invalidateQueries.mockClear()
      await act(async () => {
        await result.current.onChangeSwitch(true, 'seg-1')
      })

      expectSegmentListsRefetched()
    })
  })

  describe('onChangeSwitch', () => {
    it('should call enableSegment when enable is true', async () => {
      mockEnableSegment.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, 'seg-1')
      })

      expect(mockEnableSegment).toHaveBeenCalledWith({
        params: {
          dataset_id: 'test-dataset-id',
          document_id: 'test-document-id',
          action: 'enable',
        },
        query: { segment_id: ['seg-1'] },
      })
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('should call disableSegment when enable is false', async () => {
      mockDisableSegment.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(false, 'seg-1')
      })

      expect(mockDisableSegment).toHaveBeenCalledWith({
        params: {
          dataset_id: 'test-dataset-id',
          document_id: 'test-document-id',
          action: 'disable',
        },
        query: { segment_id: ['seg-1'] },
      })
    })

    it('should use selectedSegmentIds when segId is empty', async () => {
      mockEnableSegment.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            selectedSegmentIds: ['seg-1', 'seg-2'],
          }),
        {
          wrapper: createWrapper(),
        },
      )

      await act(async () => {
        await result.current.onChangeSwitch(true, '')
      })

      expect(mockEnableSegment).toHaveBeenCalledWith(
        expect.objectContaining({ query: { segment_id: ['seg-1', 'seg-2'] } }),
      )
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
    })

    it('should notify error on failure', async () => {
      mockEnableSegment.mockRejectedValue(new Error('Request failed'))

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await expect(result.current.onChangeSwitch(true, 'seg-1')).rejects.toThrow('Request failed')
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
    })
  })

  describe('onDelete', () => {
    it('should call deleteSegment and resetList on success', async () => {
      const clearSelection = vi.fn()
      mockDeleteSegment.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            clearSelection,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      await act(async () => {
        await result.current.onDelete('seg-1')
      })

      expect(mockDeleteSegment).toHaveBeenCalledWith({
        params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
        query: { segment_id: ['seg-1'] },
      })
      expectSegmentListsRefetched()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
    })

    it('should clear selection when deleting batch (no segId)', async () => {
      const clearSelection = vi.fn()
      mockDeleteSegment.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            selectedSegmentIds: ['seg-1', 'seg-2'],
            clearSelection,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      await act(async () => {
        await result.current.onDelete('')
      })

      expect(mockDeleteSegment).toHaveBeenCalledWith({
        params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
        query: { segment_id: ['seg-1', 'seg-2'] },
      })
      expect(clearSelection).toHaveBeenCalled()
      expectSegmentListsRefetched()
    })

    it('should notify error on failure', async () => {
      mockDeleteSegment.mockRejectedValue(new Error('Request failed'))

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await expect(result.current.onDelete('seg-1')).rejects.toThrow('Request failed')
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
    })
  })

  describe('handleUpdateSegment', () => {
    it('should validate empty content', async () => {
      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', '   ', '', [], [])
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.contentEmpty',
      })
      expect(mockUpdateSegment).not.toHaveBeenCalled()
    })

    it('should validate empty question in QA mode', async () => {
      mockDocForm.current = ChunkingModeEnum.qa

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', '', 'answer', [], [])
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.questionEmpty',
      })
    })

    it('should validate empty answer in QA mode', async () => {
      mockDocForm.current = ChunkingModeEnum.qa

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'question', '   ', [], [])
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.answerEmpty',
      })
    })

    it('should validate attachments are uploaded', async () => {
      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment(
          'seg-1',
          'content',
          '',
          [],
          [createMockFileEntity({ id: '1', name: 'test.png', uploadedId: undefined })],
        )
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.allFilesUploaded',
      })
    })

    it('should call updateSegment with correct params', async () => {
      mockUpdateSegment.mockResolvedValue({ data: createMockSegment() })

      const onCloseSegmentDetailIfCurrent = vi.fn()
      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            onCloseSegmentDetailIfCurrent,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'updated content', '', ['keyword1'], [])
      })

      expect(mockUpdateSegment).toHaveBeenCalledWith({
        params: {
          dataset_id: 'test-dataset-id',
          document_id: 'test-document-id',
          segment_id: 'seg-1',
        },
        body: {
          content: 'updated content',
          keywords: ['keyword1'],
          attachment_ids: [],
          summary: '',
        },
      })
      expectOtherStatusListsMarkedStale()
      expect(onCloseSegmentDetailIfCurrent).toHaveBeenCalledWith('seg-1')
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-segment')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-segment-success')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-segment-done')
    })

    it('should not close modal when needRegenerate is true', async () => {
      mockUpdateSegment.mockResolvedValue({ data: createMockSegment() })

      const onCloseSegmentDetailIfCurrent = vi.fn()
      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            onCloseSegmentDetailIfCurrent,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [], 'summary', true)
      })

      expect(onCloseSegmentDetailIfCurrent).not.toHaveBeenCalled()
      expect(mockUpdateSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            content: 'content',
            attachment_ids: [],
            summary: 'summary',
            regenerate_child_chunks: true,
          },
        }),
      )
    })

    it('should include attachments in params', async () => {
      mockUpdateSegment.mockResolvedValue({ data: createMockSegment() })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment(
          'seg-1',
          'content',
          '',
          [],
          [createMockFileEntity({ id: '1', name: 'test.png', uploadedId: 'uploaded-1' })],
        )
      })

      expect(mockUpdateSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ attachment_ids: ['uploaded-1'] }),
        }),
      )
    })
  })

  describe('viewNewlyAddedChunk', () => {
    it('should set needScrollToBottom and not call resetList when adding new page', () => {
      mockSegmentListData.current = {
        data: [],
        total: 10,
        total_pages: 1,
        limit: 20,
        page: 1,
      }

      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            limit: 10,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      act(() => {
        result.current.viewNewlyAddedChunk()
      })

      expect(result.current.needScrollToBottom.current).toBe(true)
    })

    it('should call resetList when not adding new page', () => {
      mockSegmentListData.current = {
        data: [],
        total: 5,
        total_pages: 1,
        limit: 20,
        page: 1,
      }

      const clearSelection = vi.fn()
      const { result } = renderHook(
        () =>
          useSegmentListData({
            ...defaultOptions,
            clearSelection,
            limit: 10,
          }),
        {
          wrapper: createWrapper(),
        },
      )

      act(() => {
        result.current.viewNewlyAddedChunk()
      })

      // resetList should be called
      expect(clearSelection).toHaveBeenCalled()
    })
  })

  describe('Effect: pathname change', () => {
    it('clears selection and reloads when navigating to another document', () => {
      const clearSelection = vi.fn()
      const { rerender } = renderHook(
        () => useSegmentListData({ ...defaultOptions, clearSelection }),
        { wrapper: createWrapper() },
      )
      clearSelection.mockClear()
      mockQueryClient.invalidateQueries.mockClear()
      mockPathname.current = '/datasets/test/documents/another'
      rerender()
      expect(clearSelection).toHaveBeenCalledTimes(1)
      expectSegmentListsRefetched()
    })
  })

  describe('Effect: import status', () => {
    it('reloads the list when an in-progress import completes', () => {
      const clearSelection = vi.fn()
      const { rerender } = renderHook(
        ({ importStatus }: { importStatus: SegmentImportStatus }) =>
          useSegmentListData({ ...defaultOptions, clearSelection, importStatus }),
        {
          wrapper: createWrapper(),
          initialProps: { importStatus: segmentImportStatus.processing as SegmentImportStatus },
        },
      )
      clearSelection.mockClear()
      mockQueryClient.invalidateQueries.mockClear()
      rerender({ importStatus: segmentImportStatus.completed })
      expect(clearSelection).toHaveBeenCalledTimes(1)
      expectSegmentListsRefetched()
    })
  })

  describe('QA Mode validation', () => {
    it('should set content and answer for QA mode', async () => {
      mockDocForm.current = ChunkingModeEnum.qa as ChunkingMode

      mockUpdateSegment.mockResolvedValue({ data: createMockSegment() })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'question', 'answer', [], [])
      })

      expect(mockUpdateSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            content: 'question',
            answer: 'answer',
          }),
        }),
      )
    })
  })

  describe('cache updates', () => {
    it('updates only selected cached segments and marks other status views stale', async () => {
      mockSegmentListData.current = {
        data: [
          createMockSegment({ id: 'seg-1', enabled: false }),
          createMockSegment({ id: 'seg-2', enabled: false }),
          createMockSegment({ id: 'seg-3', enabled: false }),
        ],
        total: 3,
        total_pages: 1,
        page: 1,
        limit: 10,
      }
      const { result } = renderHook(
        () => useSegmentListData({ ...defaultOptions, selectedSegmentIds: ['seg-1', 'seg-2'] }),
        { wrapper: createWrapper() },
      )
      const otherKey =
        consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.queryKey({
          input: {
            params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
            query: { page: 1, limit: 10, keyword: '', enabled: 'false' },
          },
        })
      queryClient.setQueryData(otherKey, mockSegmentListData.current)
      await act(async () => result.current.onChangeSwitch(true))
      expect(queryClient.getQueryData(currentKey)?.data.map((segment) => segment.enabled)).toEqual([
        true,
        true,
        false,
      ])
      expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(true)
      await waitFor(() => expect(result.current.segments[0]?.enabled).toBe(true))
    })

    it('applies a single updater to the real cache and leaves sibling segments intact', async () => {
      mockSegmentListData.current = {
        data: [createMockSegment({ id: 'seg-1' }), createMockSegment({ id: 'seg-2' })],
        total: 2,
        total_pages: 1,
        page: 1,
        limit: 10,
      }
      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })
      act(() =>
        result.current.updateSegmentInCache('seg-1', (segment) => ({ ...segment, enabled: false })),
      )
      expect(queryClient.getQueryData(currentKey)?.data.map((segment) => segment.enabled)).toEqual([
        false,
        true,
      ])
      await waitFor(() => expect(result.current.segments[0]?.enabled).toBe(false))
    })

    it('does not synthesize list data when a mutation completes before the first response', async () => {
      mockSegmentListData.current = undefined
      const { result } = renderHook(
        () => useSegmentListData({ ...defaultOptions, selectedSegmentIds: ['seg-1'] }),
        { wrapper: createWrapper() },
      )
      await act(async () => result.current.onChangeSwitch(true))
      expect(queryClient.getQueryData(currentKey)).toBeUndefined()
    })
  })
})
