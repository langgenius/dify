import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { ChunkingMode, ParentMode, SegmentDetailModel, SegmentsResponse } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode as ChunkingModeEnum } from '@/models/datasets'
import { ProcessStatus } from '../../segment-add'
import { useSegmentListData } from './use-segment-list-data'

// Type for mutation callbacks
type SegmentMutationResponse = { data: SegmentDetailModel }
type SegmentMutationCallbacks = {
  onSuccess: (res: SegmentMutationResponse) => void
  onSettled: () => void
}

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

// ============================================================================
// Hoisted Mocks
// ============================================================================

const {
  mockDocForm,
  mockParentMode,
  mockDatasetId,
  mockDocumentId,
  mockNotify,
  mockEventEmitter,
  mockQueryClient,
  mockSegmentListData,
  mockEnableSegment,
  mockDisableSegment,
  mockDeleteSegment,
  mockUpdateSegment,
  mockInvalidSegmentList,
  mockInvalidChunkListAll,
  mockInvalidChunkListEnabled,
  mockInvalidChunkListDisabled,
  mockPathname,
} = vi.hoisted(() => ({
  mockDocForm: { current: 'text' as ChunkingMode },
  mockParentMode: { current: 'paragraph' as ParentMode },
  mockDatasetId: { current: 'test-dataset-id' },
  mockDocumentId: { current: 'test-document-id' },
  mockNotify: vi.fn(),
  mockEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  mockQueryClient: { setQueryData: vi.fn() },
  mockSegmentListData: { current: { data: [] as SegmentDetailModel[], total: 0, total_pages: 0, has_more: false, limit: 20, page: 1 } as SegmentsResponse | undefined },
  mockEnableSegment: vi.fn(),
  mockDisableSegment: vi.fn(),
  mockDeleteSegment: vi.fn(),
  mockUpdateSegment: vi.fn(),
  mockInvalidSegmentList: vi.fn(),
  mockInvalidChunkListAll: vi.fn(),
  mockInvalidChunkListEnabled: vi.fn(),
  mockInvalidChunkListDisabled: vi.fn(),
  mockPathname: { current: '/datasets/test/documents/test' },
}))

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number, ns?: string }) => {
      if (key === 'actionMsg.modifiedSuccessfully')
        return 'Modified successfully'
      if (key === 'actionMsg.modifiedUnsuccessfully')
        return 'Modified unsuccessfully'
      if (key === 'segment.contentEmpty')
        return 'Content cannot be empty'
      if (key === 'segment.questionEmpty')
        return 'Question cannot be empty'
      if (key === 'segment.answerEmpty')
        return 'Answer cannot be empty'
      if (key === 'segment.allFilesUploaded')
        return 'All files must be uploaded'
      if (key === 'segment.chunks')
        return options?.count === 1 ? 'chunk' : 'chunks'
      if (key === 'segment.parentChunks')
        return options?.count === 1 ? 'parent chunk' : 'parent chunks'
      if (key === 'segment.searchResults')
        return 'search results'
      return `${options?.ns || ''}.${key}`
    },
  }),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
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
      docForm: mockDocForm.current,
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
  useSegmentList: () => ({
    isLoading: false,
    data: mockSegmentListData.current,
  }),
  useSegmentListKey: ['segment', 'chunkList'],
  useChunkListAllKey: ['segment', 'chunkList', { enabled: 'all' }],
  useChunkListEnabledKey: ['segment', 'chunkList', { enabled: true }],
  useChunkListDisabledKey: ['segment', 'chunkList', { enabled: false }],
  useEnableSegment: () => ({ mutateAsync: mockEnableSegment }),
  useDisableSegment: () => ({ mutateAsync: mockDisableSegment }),
  useDeleteSegment: () => ({ mutateAsync: mockDeleteSegment }),
  useUpdateSegment: () => ({ mutateAsync: mockUpdateSegment }),
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: (key: unknown[]) => {
    const keyObj = key[2] as { enabled?: boolean | 'all' } | undefined
    if (keyObj?.enabled === 'all')
      return mockInvalidChunkListAll
    if (keyObj?.enabled === true)
      return mockInvalidChunkListEnabled
    if (keyObj?.enabled === false)
      return mockInvalidChunkListDisabled
    return mockInvalidSegmentList
  },
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

const createMockSegment = (overrides: Partial<SegmentDetailModel> = {}): SegmentDetailModel => ({
  id: `segment-${Math.random().toString(36).substr(2, 9)}`,
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
  selectedStatus: 'all' as boolean | 'all',
  selectedSegmentIds: [] as string[],
  importStatus: undefined as ProcessStatus | string | undefined,
  currentPage: 1,
  limit: 10,
  onCloseSegmentDetail: vi.fn(),
  clearSelection: vi.fn(),
}

// ============================================================================
// Tests
// ============================================================================

describe('useSegmentListData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingModeEnum.text as ChunkingMode
    mockParentMode.current = 'paragraph'
    mockDatasetId.current = 'test-dataset-id'
    mockDocumentId.current = 'test-document-id'
    mockSegmentListData.current = { data: [], total: 0, total_pages: 0, has_more: false, limit: 20, page: 1 }
    mockPathname.current = '/datasets/test/documents/test'
  })

  describe('Initial State', () => {
    it('should return empty segments initially', () => {
      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.segments).toEqual([])
      expect(result.current.isLoadingSegmentList).toBe(false)
    })

    it('should compute isFullDocMode correctly', () => {
      mockDocForm.current = ChunkingModeEnum.parentChild
      mockParentMode.current = 'full-doc'

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.isFullDocMode).toBe(true)
    })

    it('should compute isFullDocMode as false for text mode', () => {
      mockDocForm.current = ChunkingModeEnum.text

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.isFullDocMode).toBe(false)
    })
  })

  describe('totalText computation', () => {
    it('should show chunks count when not searching', () => {
      mockSegmentListData.current = { data: [], total: 10, total_pages: 1, has_more: false, limit: 20, page: 1 }

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('10')
      expect(result.current.totalText).toContain('chunks')
    })

    it('should show search results when searching', () => {
      mockSegmentListData.current = { data: [], total: 5, total_pages: 1, has_more: false, limit: 20, page: 1 }

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        searchValue: 'test',
      }), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('5')
      expect(result.current.totalText).toContain('search results')
    })

    it('should show search results when status is filtered', () => {
      mockSegmentListData.current = { data: [], total: 3, total_pages: 1, has_more: false, limit: 20, page: 1 }

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedStatus: true,
      }), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('search results')
    })

    it('should show parent chunks in parentChild paragraph mode', () => {
      mockDocForm.current = ChunkingModeEnum.parentChild
      mockParentMode.current = 'paragraph'
      mockSegmentListData.current = { data: [], total: 7, total_pages: 1, has_more: false, limit: 20, page: 1 }

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.totalText).toContain('parent chunk')
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

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        clearSelection,
      }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.resetList()
      })

      expect(clearSelection).toHaveBeenCalled()
      expect(mockInvalidSegmentList).toHaveBeenCalled()
    })
  })

  describe('refreshChunkListWithStatusChanged', () => {
    it('should invalidate disabled and enabled when status is all', async () => {
      mockEnableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedStatus: 'all',
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, 'seg-1')
      })

      expect(mockInvalidChunkListDisabled).toHaveBeenCalled()
      expect(mockInvalidChunkListEnabled).toHaveBeenCalled()
    })

    it('should invalidate segment list when status is not all', async () => {
      mockEnableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedStatus: true,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, 'seg-1')
      })

      expect(mockInvalidSegmentList).toHaveBeenCalled()
    })
  })

  describe('onChangeSwitch', () => {
    it('should call enableSegment when enable is true', async () => {
      mockEnableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, 'seg-1')
      })

      expect(mockEnableSegment).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'Modified successfully' })
    })

    it('should call disableSegment when enable is false', async () => {
      mockDisableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(false, 'seg-1')
      })

      expect(mockDisableSegment).toHaveBeenCalled()
    })

    it('should use selectedSegmentIds when segId is empty', async () => {
      mockEnableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedSegmentIds: ['seg-1', 'seg-2'],
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, '')
      })

      expect(mockEnableSegment).toHaveBeenCalledWith(
        expect.objectContaining({ segmentIds: ['seg-1', 'seg-2'] }),
        expect.any(Object),
      )
    })

    it('should notify error on failure', async () => {
      mockEnableSegment.mockImplementation(async (_params, { onError }: { onError: () => void }) => {
        onError()
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, 'seg-1')
      })

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Modified unsuccessfully' })
    })
  })

  describe('onDelete', () => {
    it('should call deleteSegment and resetList on success', async () => {
      const clearSelection = vi.fn()
      mockDeleteSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        clearSelection,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDelete('seg-1')
      })

      expect(mockDeleteSegment).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'Modified successfully' })
    })

    it('should clear selection when deleting batch (no segId)', async () => {
      const clearSelection = vi.fn()
      mockDeleteSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedSegmentIds: ['seg-1', 'seg-2'],
        clearSelection,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDelete('')
      })

      // clearSelection is called twice: once in resetList, once after
      expect(clearSelection).toHaveBeenCalled()
    })

    it('should notify error on failure', async () => {
      mockDeleteSegment.mockImplementation(async (_params, { onError }: { onError: () => void }) => {
        onError()
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onDelete('seg-1')
      })

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Modified unsuccessfully' })
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

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Content cannot be empty' })
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

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Question cannot be empty' })
    })

    it('should validate empty answer in QA mode', async () => {
      mockDocForm.current = ChunkingModeEnum.qa

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'question', '   ', [], [])
      })

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Answer cannot be empty' })
    })

    it('should validate attachments are uploaded', async () => {
      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [
          createMockFileEntity({ id: '1', name: 'test.png', uploadedId: undefined }),
        ])
      })

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'All files must be uploaded' })
    })

    it('should call updateSegment with correct params', async () => {
      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

      const onCloseSegmentDetail = vi.fn()
      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        onCloseSegmentDetail,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'updated content', '', ['keyword1'], [])
      })

      expect(mockUpdateSegment).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'Modified successfully' })
      expect(onCloseSegmentDetail).toHaveBeenCalled()
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-segment')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-segment-success')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-segment-done')
    })

    it('should not close modal when needRegenerate is true', async () => {
      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

      const onCloseSegmentDetail = vi.fn()
      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        onCloseSegmentDetail,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [], 'summary', true)
      })

      expect(onCloseSegmentDetail).not.toHaveBeenCalled()
    })

    it('should include attachments in params', async () => {
      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [
          createMockFileEntity({ id: '1', name: 'test.png', uploadedId: 'uploaded-1' }),
        ])
      })

      expect(mockUpdateSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ attachment_ids: ['uploaded-1'] }),
        }),
        expect.any(Object),
      )
    })
  })

  describe('viewNewlyAddedChunk', () => {
    it('should set needScrollToBottom and not call resetList when adding new page', () => {
      mockSegmentListData.current = { data: [], total: 10, total_pages: 1, has_more: false, limit: 20, page: 1 }

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        limit: 10,
      }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.viewNewlyAddedChunk()
      })

      expect(result.current.needScrollToBottom.current).toBe(true)
    })

    it('should call resetList when not adding new page', () => {
      mockSegmentListData.current = { data: [], total: 5, total_pages: 1, has_more: false, limit: 20, page: 1 }

      const clearSelection = vi.fn()
      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        clearSelection,
        limit: 10,
      }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.viewNewlyAddedChunk()
      })

      // resetList should be called
      expect(clearSelection).toHaveBeenCalled()
    })
  })

  describe('updateSegmentInCache', () => {
    it('should call queryClient.setQueryData', () => {
      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.updateSegmentInCache('seg-1', seg => ({ ...seg, enabled: false }))
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })
  })

  describe('Effect: pathname change', () => {
    it('should reset list when pathname changes', async () => {
      const clearSelection = vi.fn()

      renderHook(() => useSegmentListData({
        ...defaultOptions,
        clearSelection,
      }), {
        wrapper: createWrapper(),
      })

      // Initial call from effect
      expect(clearSelection).toHaveBeenCalled()
      expect(mockInvalidSegmentList).toHaveBeenCalled()
    })
  })

  describe('Effect: import status', () => {
    it('should reset list when import status is COMPLETED', () => {
      const clearSelection = vi.fn()

      renderHook(() => useSegmentListData({
        ...defaultOptions,
        importStatus: ProcessStatus.COMPLETED,
        clearSelection,
      }), {
        wrapper: createWrapper(),
      })

      expect(clearSelection).toHaveBeenCalled()
    })
  })

  describe('refreshChunkListDataWithDetailChanged', () => {
    it('should call correct invalidation for status all', async () => {
      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedStatus: 'all',
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [])
      })

      expect(mockInvalidChunkListDisabled).toHaveBeenCalled()
      expect(mockInvalidChunkListEnabled).toHaveBeenCalled()
    })

    it('should call correct invalidation for status true', async () => {
      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedStatus: true,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [])
      })

      expect(mockInvalidChunkListAll).toHaveBeenCalled()
      expect(mockInvalidChunkListDisabled).toHaveBeenCalled()
    })

    it('should call correct invalidation for status false', async () => {
      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedStatus: false,
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.handleUpdateSegment('seg-1', 'content', '', [], [])
      })

      expect(mockInvalidChunkListAll).toHaveBeenCalled()
      expect(mockInvalidChunkListEnabled).toHaveBeenCalled()
    })
  })

  describe('QA Mode validation', () => {
    it('should set content and answer for QA mode', async () => {
      mockDocForm.current = ChunkingModeEnum.qa as ChunkingMode

      mockUpdateSegment.mockImplementation(async (_params, { onSuccess, onSettled }: SegmentMutationCallbacks) => {
        onSuccess({ data: createMockSegment() })
        onSettled()
      })

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
        expect.any(Object),
      )
    })
  })

  describe('updateSegmentsInCache', () => {
    it('should handle undefined old data', () => {
      mockQueryClient.setQueryData.mockImplementation((_key, updater) => {
        const result = typeof updater === 'function' ? updater(undefined) : updater
        return result
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      // Call updateSegmentInCache which should handle undefined gracefully
      act(() => {
        result.current.updateSegmentInCache('seg-1', seg => ({ ...seg, enabled: false }))
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })

    it('should map segments correctly when old data exists', () => {
      const mockOldData = {
        data: [
          createMockSegment({ id: 'seg-1', enabled: true }),
          createMockSegment({ id: 'seg-2', enabled: true }),
        ],
        total: 2,
        total_pages: 1,
      }

      mockQueryClient.setQueryData.mockImplementation((_key, updater) => {
        const result = typeof updater === 'function' ? updater(mockOldData) : updater
        // Verify the updater transforms the data correctly
        expect(result.data[0].enabled).toBe(false) // seg-1 should be updated
        expect(result.data[1].enabled).toBe(true) // seg-2 should remain unchanged
        return result
      })

      const { result } = renderHook(() => useSegmentListData(defaultOptions), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.updateSegmentInCache('seg-1', seg => ({ ...seg, enabled: false }))
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })
  })

  describe('updateSegmentsInCache batch', () => {
    it('should handle undefined old data in batch update', async () => {
      mockQueryClient.setQueryData.mockImplementation((_key, updater) => {
        const result = typeof updater === 'function' ? updater(undefined) : updater
        return result
      })

      mockEnableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedSegmentIds: ['seg-1', 'seg-2'],
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, '')
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })

    it('should map multiple segments correctly when old data exists', async () => {
      const mockOldData = {
        data: [
          createMockSegment({ id: 'seg-1', enabled: false }),
          createMockSegment({ id: 'seg-2', enabled: false }),
          createMockSegment({ id: 'seg-3', enabled: false }),
        ],
        total: 3,
        total_pages: 1,
      }

      mockQueryClient.setQueryData.mockImplementation((_key, updater) => {
        const result = typeof updater === 'function' ? updater(mockOldData) : updater
        // Verify only selected segments are updated
        if (result && result.data) {
          expect(result.data[0].enabled).toBe(true) // seg-1 should be updated
          expect(result.data[1].enabled).toBe(true) // seg-2 should be updated
          expect(result.data[2].enabled).toBe(false) // seg-3 should remain unchanged
        }
        return result
      })

      mockEnableSegment.mockImplementation(async (_params, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess()
      })

      const { result } = renderHook(() => useSegmentListData({
        ...defaultOptions,
        selectedSegmentIds: ['seg-1', 'seg-2'],
      }), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.onChangeSwitch(true, '')
      })

      expect(mockQueryClient.setQueryData).toHaveBeenCalled()
    })
  })
})
