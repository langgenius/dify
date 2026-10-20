import type {
  ChildChunkListResponse,
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { ChunkingMode, ParentMode } from '@/models/datasets'
import { act, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useChildSegmentData } from '../use-child-segment-data'

// Hoisted Mocks

const {
  getChildren,
  mockParentMode,
  mockDatasetId,
  mockDocumentId,
  mockNotify,
  mockEventEmitter,
  mockDeleteChildSegment,
  mockUpdateChildSegment,
} = vi.hoisted(() => ({
  mockParentMode: { current: 'paragraph' as ParentMode },
  mockDatasetId: { current: 'test-dataset-id' },
  mockDocumentId: { current: 'test-document-id' },
  mockNotify: vi.fn(),
  mockEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  getChildren: vi.fn(),
  mockDeleteChildSegment: vi.fn(),
  mockUpdateChildSegment: vi.fn(),
}))

vi.mock('../../../context', () => ({
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

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get':
        getChildren,
      'datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.byChildChunkId.delete':
        mockDeleteChildSegment,
      'datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.byChildChunkId.patch':
        mockUpdateChildSegment,
    }),
  }
})

const createMockChildChunk = (overrides: Partial<ChildChunkResponse> = {}): ChildChunkResponse => ({
  id: 'child-1',
  position: 1,
  segment_id: 'segment-1',
  content: 'Child chunk content',
  word_count: 100,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
  ...overrides,
})

const createMockSegment = (overrides: Partial<SegmentResponse> = {}): SegmentResponse => ({
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
  currentPage: 1,
  limit: 10,
  segments: [createMockSegment()] as SegmentResponse[],
  currChunkId: 'segment-1',
  isFullDocMode: true,
  onCloseChildSegmentDetail: vi.fn(),
  refreshChunkListDataWithDetailChanged: vi.fn(),
  updateSegmentInCache: vi.fn(),
}

const childPage = (data: ChildChunkResponse[] = []): ChildChunkListResponse => ({
  data,
  total: data.length,
  total_pages: data.length ? 1 : 0,
  page: 1,
  limit: 10,
})
const parentKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.queryKey({
  input: {
    params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
    query: { page: 1, limit: 10, keyword: '', enabled: 'all' },
  },
})
const renderChildren = (
  overrides: Partial<Parameters<typeof useChildSegmentData>[0]> = {},
  seed = true,
) => {
  const queryClient = createConsoleQueryClient()
  const children = [
    createMockChildChunk(),
    createMockChildChunk({ id: 'child-2', content: 'Other content' }),
  ]
  const parent = createMockSegment({ child_chunks: children })
  queryClient.setQueryData(parentKey, {
    data: [parent],
    total: 1,
    total_pages: 1,
    page: 1,
    limit: 10,
  })
  const options = {
    ...defaultOptions,
    updateSegmentInCache: (id: string, update: (segment: SegmentResponse) => SegmentResponse) => {
      queryClient.setQueryData(
        parentKey,
        (old) =>
          old && {
            ...old,
            data: old.data.map((segment) => (segment.id === id ? update(segment) : segment)),
          },
      )
    },
    ...overrides,
  }
  const childKey =
    consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get.queryKey(
      {
        input: {
          params: {
            dataset_id: 'test-dataset-id',
            document_id: 'test-document-id',
            segment_id: options.segments[0]?.id ?? '',
          },
          query: {
            page: options.currentPage || 1,
            limit: options.limit,
            keyword: options.searchValue,
          },
        },
      },
    )
  if (seed) queryClient.setQueryData(childKey, childPage(children))
  return {
    ...renderHookWithConsoleQuery(() => useChildSegmentData(options), { queryClient }),
    childKey,
  }
}

describe('useChildSegmentData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParentMode.current = 'paragraph'
    getChildren.mockReset().mockImplementation(() => new Promise(() => {}))
    mockDeleteChildSegment.mockReset().mockResolvedValue({ result: 'success' })
    mockUpdateChildSegment.mockReset().mockResolvedValue({
      data: createMockChildChunk({
        content: 'Updated content',
        word_count: 50,
        type: 'customized',
      }),
    })
  })

  it('loads child chunks and uses page one for the initial zero page', async () => {
    getChildren.mockResolvedValue(childPage([createMockChildChunk()]))
    const { result } = renderChildren({ currentPage: 0 }, false)
    expect(result.current.isLoadingChildSegmentList).toBe(true)
    await waitFor(() => expect(result.current.childSegments).toHaveLength(1))
    expect(result.current.isLoadingChildSegmentList).toBe(false)
    expect(getChildren).toHaveBeenCalledWith({
      params: {
        dataset_id: 'test-dataset-id',
        document_id: 'test-document-id',
        segment_id: 'segment-1',
      },
      query: { page: 1, limit: 10, keyword: '' },
    })
  })

  it.each([{ isFullDocMode: false }, { segments: [] }])(
    'does not fetch children when the query is disabled (%j)',
    async (options) => {
      const { result } = renderChildren(options, false)
      await act(async () => {})
      expect(getChildren).not.toHaveBeenCalled()
      expect(result.current.childSegments).toEqual([])
      expect(result.current.isLoadingChildSegmentList).toBe(false)
    },
  )

  it('deletes the selected child from its parent cache without changing siblings', async () => {
    const { result, queryClient } = renderChildren()
    await act(async () => result.current.onDeleteChildChunk('segment-1', 'child-1'))
    expect(
      queryClient.getQueryData(parentKey)?.data[0]?.child_chunks?.map((child) => child.id),
    ).toEqual(['child-2'])
    expect(mockDeleteChildSegment).toHaveBeenCalledWith({
      params: {
        dataset_id: 'test-dataset-id',
        document_id: 'test-document-id',
        segment_id: 'segment-1',
        child_chunk_id: 'child-1',
      },
    })
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.actionMsg.modifiedSuccessfully',
    })
  })

  it('refetches the full-document child list after deletion', async () => {
    mockParentMode.current = 'full-doc'
    getChildren.mockResolvedValue(childPage([createMockChildChunk({ id: 'child-2' })]))
    const { result } = renderChildren()
    await act(async () => result.current.onDeleteChildChunk('segment-1', 'child-1'))
    await waitFor(() =>
      expect(result.current.childSegments.map((child) => child.id)).toEqual(['child-2']),
    )
    expect(getChildren).toHaveBeenCalledOnce()
  })

  it('reports a failed deletion without modifying cached children', async () => {
    mockDeleteChildSegment.mockRejectedValue(new Error('Delete failed'))
    const { result, queryClient } = renderChildren()
    const original = queryClient.getQueryData(parentKey)
    await act(async () => {
      await expect(result.current.onDeleteChildChunk('segment-1', 'child-1')).rejects.toThrow(
        'Delete failed',
      )
    })
    expect(queryClient.getQueryData(parentKey)).toEqual(original)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'common.actionMsg.modifiedUnsuccessfully',
    })
  })

  it.each(['paragraph', 'full-doc'] as const)(
    'updates the %s cache after the response and settles the edit event',
    async (mode) => {
      mockParentMode.current = mode
      const request = createDeferred<{ data: ChildChunkResponse }>()
      mockUpdateChildSegment.mockReturnValue(request.promise)
      const { result, queryClient, childKey } = renderChildren()
      let update: Promise<void>
      act(() => {
        update = result.current.handleUpdateChildChunk('segment-1', 'child-1', 'Updated content')
      })
      expect(defaultOptions.onCloseChildSegmentDetail).not.toHaveBeenCalled()
      await act(async () => {
        request.resolve({
          data: createMockChildChunk({
            content: 'Updated content',
            type: 'customized',
            word_count: 50,
          }),
        })
        await update
      })
      const children =
        mode === 'paragraph'
          ? queryClient.getQueryData(parentKey)?.data[0]?.child_chunks
          : queryClient.getQueryData(childKey)?.data
      expect(children?.map((child) => child.content)).toEqual(['Updated content', 'Other content'])
      expect(defaultOptions.onCloseChildSegmentDetail).toHaveBeenCalledOnce()
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-child-segment')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-child-segment-done')
    },
  )

  it('settles the editing event after a rejected update without closing or changing data', async () => {
    mockUpdateChildSegment.mockRejectedValue(new Error('Update failed'))
    const { result, queryClient } = renderChildren()
    const original = queryClient.getQueryData(parentKey)
    await act(async () => {
      await expect(
        result.current.handleUpdateChildChunk('segment-1', 'child-1', 'Updated content'),
      ).rejects.toThrow('Update failed')
    })
    expect(queryClient.getQueryData(parentKey)).toEqual(original)
    expect(defaultOptions.onCloseChildSegmentDetail).not.toHaveBeenCalled()
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('update-child-segment-done')
  })

  it('does not create cache data when updating an uncached full document', async () => {
    mockParentMode.current = 'full-doc'
    const { result, queryClient, childKey } = renderChildren({}, false)
    await act(async () =>
      result.current.handleUpdateChildChunk('segment-1', 'child-1', 'Updated content'),
    )
    expect(queryClient.getQueryData(childKey)).toBeUndefined()
  })

  it('rejects blank content before sending an update', async () => {
    const { result } = renderChildren()
    await act(async () => result.current.handleUpdateChildChunk('segment-1', 'child-1', '  '))
    expect(mockUpdateChildSegment).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'datasetDocuments.segment.contentEmpty',
    })
  })

  it('adds a new child to its parent and refreshes the owning detail', () => {
    const { result, queryClient } = renderChildren()
    act(() => result.current.onSaveNewChildChunk(createMockChildChunk({ id: 'new-child' })))
    expect(
      queryClient.getQueryData(parentKey)?.data[0]?.child_chunks?.map((child) => child.id),
    ).toEqual(['child-1', 'child-2', 'new-child'])
    expect(defaultOptions.refreshChunkListDataWithDetailChanged).toHaveBeenCalledOnce()
  })
})
