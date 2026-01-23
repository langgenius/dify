import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { ChildChunkDetail, ChildSegmentsResponse, ChunkingMode, ParentMode, SegmentDetailModel } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { useChildSegmentData } from './use-child-segment-data'

// Type for mutation callbacks
type MutationResponse = { data: ChildChunkDetail }
type MutationCallbacks = {
  onSuccess: (res: MutationResponse) => void
  onSettled: () => void
}
type _ErrorCallback = { onSuccess?: () => void, onError: () => void }

// ============================================================================
// Hoisted Mocks
// ============================================================================

const {
  mockParentMode,
  mockDatasetId,
  mockDocumentId,
  mockNotify,
  mockEventEmitter,
  mockQueryClient,
  mockChildSegmentListData,
  mockDeleteChildSegment,
  mockUpdateChildSegment,
  mockInvalidChildSegmentList,
} = vi.hoisted(() => ({
  mockParentMode: { current: 'paragraph' as ParentMode },
  mockDatasetId: { current: 'test-dataset-id' },
  mockDocumentId: { current: 'test-document-id' },
  mockNotify: vi.fn(),
  mockEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  mockQueryClient: { setQueryData: vi.fn() },
  mockChildSegmentListData: { current: { data: [] as ChildChunkDetail[], total: 0, total_pages: 0 } as ChildSegmentsResponse | undefined },
  mockDeleteChildSegment: vi.fn(),
  mockUpdateChildSegment: vi.fn(),
  mockInvalidChildSegmentList: vi.fn(),
}))

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'actionMsg.modifiedSuccessfully')
        return 'Modified successfully'
      if (key === 'actionMsg.modifiedUnsuccessfully')
        return 'Modified unsuccessfully'
      if (key === 'segment.contentEmpty')
        return 'Content cannot be empty'
      return key
    },
  }),
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: () => mockQueryClient,
  }
})

vi.mock('../../context', () => ({
  useDocumentContext: (selector: (value: DocumentContextValue) => unknown) => {
    const value: DocumentContextValue = {
      datasetId: mockDatasetId.current,
      documentId: mockDocumentId.current,
      docForm: 'text' as ChunkingMode,
      parentMode: mockParentMode.current,
    }
    return selector(value)
  },
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

vi.mock('@/service/knowledge/use-segment', () => ({
  useChildSegmentList: () => ({
    isLoading: false,
    data: mockChildSegmentListData.current,
  }),
  useChildSegmentListKey: ['segment', 'childChunkList'],
  useDeleteChildSegment: () => ({ mutateAsync: mockDeleteChildSegment }),
  useUpdateChildSegment: () => ({ mutateAsync: mockUpdateChildSegment }),
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => mockInvalidChildSegmentList,
}))

// ============================================================================
// Test Utilities
// ============================================================================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const createWrapper = () => {
  const queryClient = createQueryClient()
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

const createMockChildChunk = (overrides: Partial<ChildChunkDetail> = {}): ChildChunkDetail => ({
  id: `child-${Math.random().toString(36).substr(2, 9)}`,
  position: 1,
  segment_id: 'segment-1',
  content: 'Child chunk content',
  word_count: 100,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
  ...overrides,
})

const createMockSegment = (overrides: Partial<SegmentDetailModel> = {}): SegmentDetailModel => ({
  id: 'segment-1',
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
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [],
  ...overrides,
})

const defaultOptions = {
  searchValue: '',
  currentPage: 1,
  limit: 10,
  segments: [createMockSegment()] as SegmentDetailModel[],
  currChunkId: 'segment-1',
  isFullDocMode: true,
  onCloseChildSegmentDetail: vi.fn(),
  refreshChunkListDataWithDetailChanged: vi.fn(),
  updateSegmentInCache: vi.fn(),
}

// ============================================================================
// Tests
// ============================================================================

describe('useChildSegmentData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParentMode.current = 'paragraph'
    mockDatasetId.current = 'test-dataset-id'
    mockDocumentId.current = 'test-document-id'
    mockChildSegmentListData.current = { data: [], total: 0, total_pages: 0, page: 1, limit: 20 }
  })

  describe('Initial State', () => {
    it('should return empty child segments initially', () => {
      const { result } = renderHook(() => useChildSegmentData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.childSegments).toEqual([])
      expect(result.current.isLoadingChildSegmentList).toBe(false)
    })
  })

  describe('resetChildList', () => {
    it('should call invalidChildSegmentList', () => {
      const { result } = renderHook(() => useChildSegmentData(defaultOptions), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.resetChildList()
      })

      expect(mockInvalidChildSegmentList).toHaveBeenCalled()
    })
  })

  describe('onDeleteChildChunk', () => {
    it('should delete child chunk and update parent cache in paragraph mode', async () => {
      mockParentMode.current = 'paragraph'
      const updateSegmentInCache = vi.fn()

      mockDeleteChildSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        updateSegmentInCache,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDeleteChildChunk('seg-1', 'child-1')
      })

      expect(mockDeleteChildSegment).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'Modified successfully' })
      expect(updateSegmentInCache).toHaveBeenCalledWith('seg-1', expect.any(Function))
    })

    it('should delete child chunk and reset list in full-doc mode', async () => {
      mockParentMode.current = 'full-doc'

      mockDeleteChildSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useChildSegmentData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDeleteChildChunk('seg-1', 'child-1')
      })

      expect(mockInvalidChildSegmentList).toHaveBeenCalled()
    })

    it('should notify error on failure', async () => {
      mockDeleteChildSegment.mockImplementation(async (_params, { onError }: { onError: () => void }) => {
        onError()
      })

      const { result } = renderHook(() => useChildSegmentData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDeleteChildChunk('seg-1', 'child-1')
      })

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Modified unsuccessfully' })
    })
  })

  describe('handleUpdateChildChunk', () => {
    it('should validate empty content', async () => {
      const { result } = renderHook(() => useChildSegmentData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateChildChunk('seg-1', 'child-1', '   ')
      })

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Content cannot be empty' })
      expect(mockUpdateChildSegment).not.toHaveBeenCalled()
    })

    it('should update child chunk and parent cache in paragraph mode', async () => {
      mockParentMode.current = 'paragraph'
      const updateSegmentInCache = vi.fn()
      const onCloseChildSegmentDetail = vi.fn()
      const refreshChunkListDataWithDetailChanged = vi.fn()

      mockUpdateChildSegment.mockImplementation(async (_params, { onSuccess, onSettled }: MutationCallbacks) => {
        onSuccess({
          data: createMockChildChunk({
            content: 'updated content',
            type: 'customized',
            word_count: 50,
            updated_at: 1700000001,
          }),
        })
        onSettled()
      })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        updateSegmentInCache,
        onCloseChildSegmentDetail,
        refreshChunkListDataWithDetailChanged,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateChildChunk('seg-1', 'child-1', 'updated content')
      })

      expect(mockUpdateChildSegment).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'Modified successfully' })
      expect(onCloseChildSegmentDetail).toHaveBeenCalled()
      expect(updateSegmentInCache).toHaveBeenCalled()
      expect(refreshChunkListDataWithDetailChanged).toHaveBeenCalled()
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-child-segment')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-child-segment-done')
    })

    it('should update child chunk cache in full-doc mode', async () => {
      mockParentMode.current = 'full-doc'
      const onCloseChildSegmentDetail = vi.fn()

      mockUpdateChildSegment.mockImplementation(async (_params, { onSuccess, onSettled }: MutationCallbacks) => {
        onSuccess({
          data: createMockChildChunk({
            content: 'updated content',
            type: 'customized',
            word_count: 50,
            updated_at: 1700000001,
          }),
        })
        onSettled()
      })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        onCloseChildSegmentDetail,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateChildChunk('seg-1', 'child-1', 'updated content')
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })
  })

  describe('onSaveNewChildChunk', () => {
    it('should update parent cache in paragraph mode', () => {
      mockParentMode.current = 'paragraph'
      const updateSegmentInCache = vi.fn()
      const refreshChunkListDataWithDetailChanged = vi.fn()
      const newChildChunk = createMockChildChunk({ id: 'new-child' })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        updateSegmentInCache,
        refreshChunkListDataWithDetailChanged,
      }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.onSaveNewChildChunk(newChildChunk)
      })

      expect(updateSegmentInCache).toHaveBeenCalled()
      expect(refreshChunkListDataWithDetailChanged).toHaveBeenCalled()
    })

    it('should reset child list in full-doc mode', () => {
      mockParentMode.current = 'full-doc'

      const { result } = renderHook(() => useChildSegmentData(defaultOptions), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.onSaveNewChildChunk(createMockChildChunk())
      })

      expect(mockInvalidChildSegmentList).toHaveBeenCalled()
    })
  })

  describe('viewNewlyAddedChildChunk', () => {
    it('should set needScrollToBottom and not reset when adding new page', () => {
      mockChildSegmentListData.current = { data: [], total: 10, total_pages: 1, page: 1, limit: 20 }

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        limit: 10,
      }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.viewNewlyAddedChildChunk()
      })

      expect(result.current.needScrollToBottom.current).toBe(true)
    })

    it('should call resetChildList when not adding new page', () => {
      mockChildSegmentListData.current = { data: [], total: 5, total_pages: 1, page: 1, limit: 20 }

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        limit: 10,
      }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.viewNewlyAddedChildChunk()
      })

      expect(mockInvalidChildSegmentList).toHaveBeenCalled()
    })
  })

  describe('Query disabled states', () => {
    it('should disable query when not in fullDocMode', () => {
      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        isFullDocMode: false,
      }), {
        wrapper: createWrapper(),
      })

      // Query should be disabled but hook should still work
      expect(result.current.childSegments).toEqual([])
    })

    it('should disable query when segments is empty', () => {
      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        segments: [],
      }), {
        wrapper: createWrapper(),
      })

      expect(result.current.childSegments).toEqual([])
    })
  })

  describe('Cache update callbacks', () => {
    it('should use updateSegmentInCache when deleting in paragraph mode', async () => {
      mockParentMode.current = 'paragraph'
      const updateSegmentInCache = vi.fn()

      mockDeleteChildSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        updateSegmentInCache,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDeleteChildChunk('seg-1', 'child-1')
      })

      expect(updateSegmentInCache).toHaveBeenCalledWith('seg-1', expect.any(Function))

      // Verify the updater function filters correctly
      const updaterFn = updateSegmentInCache.mock.calls[0][1]
      const testSegment = createMockSegment({
        child_chunks: [
          createMockChildChunk({ id: 'child-1' }),
          createMockChildChunk({ id: 'child-2' }),
        ],
      })
      const updatedSegment = updaterFn(testSegment)
      expect(updatedSegment.child_chunks).toHaveLength(1)
      expect(updatedSegment.child_chunks[0].id).toBe('child-2')
    })

    it('should use updateSegmentInCache when updating in paragraph mode', async () => {
      mockParentMode.current = 'paragraph'
      const updateSegmentInCache = vi.fn()
      const onCloseChildSegmentDetail = vi.fn()
      const refreshChunkListDataWithDetailChanged = vi.fn()

      mockUpdateChildSegment.mockImplementation(async (_params, { onSuccess, onSettled }: MutationCallbacks) => {
        onSuccess({
          data: createMockChildChunk({
            id: 'child-1',
            content: 'new content',
            type: 'customized',
            word_count: 50,
            updated_at: 1700000001,
          }),
        })
        onSettled()
      })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        updateSegmentInCache,
        onCloseChildSegmentDetail,
        refreshChunkListDataWithDetailChanged,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateChildChunk('seg-1', 'child-1', 'new content')
      })

      expect(updateSegmentInCache).toHaveBeenCalledWith('seg-1', expect.any(Function))

      // Verify the updater function maps correctly
      const updaterFn = updateSegmentInCache.mock.calls[0][1]
      const testSegment = createMockSegment({
        child_chunks: [
          createMockChildChunk({ id: 'child-1', content: 'old content' }),
          createMockChildChunk({ id: 'child-2', content: 'other content' }),
        ],
      })
      const updatedSegment = updaterFn(testSegment)
      expect(updatedSegment.child_chunks).toHaveLength(2)
      expect(updatedSegment.child_chunks[0].content).toBe('new content')
      expect(updatedSegment.child_chunks[1].content).toBe('other content')
    })
  })

  describe('updateChildSegmentInCache in full-doc mode', () => {
    it('should use updateChildSegmentInCache when updating in full-doc mode', async () => {
      mockParentMode.current = 'full-doc'
      const onCloseChildSegmentDetail = vi.fn()

      mockUpdateChildSegment.mockImplementation(async (_params, { onSuccess, onSettled }: MutationCallbacks) => {
        onSuccess({
          data: createMockChildChunk({
            id: 'child-1',
            content: 'new content',
            type: 'customized',
            word_count: 50,
            updated_at: 1700000001,
          }),
        })
        onSettled()
      })

      const { result } = renderHook(() => useChildSegmentData({
        ...defaultOptions,
        onCloseChildSegmentDetail,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateChildChunk('seg-1', 'child-1', 'new content')
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })
  })
})
