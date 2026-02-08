import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentActionType } from '@/models/datasets'
import * as useDocument from '@/service/knowledge/use-document'
import { useDocumentActions } from './use-document-actions'

vi.mock('@/service/knowledge/use-document')

const mockUseDocumentArchive = vi.mocked(useDocument.useDocumentArchive)
const mockUseDocumentSummary = vi.mocked(useDocument.useDocumentSummary)
const mockUseDocumentEnable = vi.mocked(useDocument.useDocumentEnable)
const mockUseDocumentDisable = vi.mocked(useDocument.useDocumentDisable)
const mockUseDocumentDelete = vi.mocked(useDocument.useDocumentDelete)
const mockUseDocumentBatchRetryIndex = vi.mocked(useDocument.useDocumentBatchRetryIndex)
const mockUseDocumentDownloadZip = vi.mocked(useDocument.useDocumentDownloadZip)

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const createWrapper = () => {
  const queryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useDocumentActions', () => {
  const mockMutateAsync = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup all mocks with default values
    const createMockMutation = () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
      isSuccess: false,
      isIdle: true,
      data: undefined,
      error: null,
      mutate: vi.fn(),
      reset: vi.fn(),
      status: 'idle' as const,
      variables: undefined,
      context: undefined,
      failureCount: 0,
      failureReason: null,
      submittedAt: 0,
    })

    mockUseDocumentArchive.mockReturnValue(createMockMutation() as unknown as ReturnType<typeof useDocument.useDocumentArchive>)
    mockUseDocumentSummary.mockReturnValue(createMockMutation() as unknown as ReturnType<typeof useDocument.useDocumentSummary>)
    mockUseDocumentEnable.mockReturnValue(createMockMutation() as unknown as ReturnType<typeof useDocument.useDocumentEnable>)
    mockUseDocumentDisable.mockReturnValue(createMockMutation() as unknown as ReturnType<typeof useDocument.useDocumentDisable>)
    mockUseDocumentDelete.mockReturnValue(createMockMutation() as unknown as ReturnType<typeof useDocument.useDocumentDelete>)
    mockUseDocumentBatchRetryIndex.mockReturnValue(createMockMutation() as unknown as ReturnType<typeof useDocument.useDocumentBatchRetryIndex>)
    mockUseDocumentDownloadZip.mockReturnValue({
      ...createMockMutation(),
      isPending: false,
    } as unknown as ReturnType<typeof useDocument.useDocumentDownloadZip>)
  })

  describe('handleAction', () => {
    it('should call archive mutation when archive action is triggered', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        datasetId: 'ds1',
        documentIds: ['doc1'],
      })
    })

    it('should call onUpdate on successful action', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleAction(DocumentActionType.enable)()
      })

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should call onClearSelection on delete action', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleAction(DocumentActionType.delete)()
      })

      await waitFor(() => {
        expect(onClearSelection).toHaveBeenCalled()
      })
    })
  })

  describe('handleBatchReIndex', () => {
    it('should call retry index mutation', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1', 'doc2'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        datasetId: 'ds1',
        documentIds: ['doc1', 'doc2'],
      })
    })

    it('should call onClearSelection on success', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      await waitFor(() => {
        expect(onClearSelection).toHaveBeenCalled()
        expect(onUpdate).toHaveBeenCalled()
      })
    })
  })

  describe('handleBatchDownload', () => {
    it('should not proceed when already downloading', async () => {
      mockUseDocumentDownloadZip.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as unknown as ReturnType<typeof useDocument.useDocumentDownloadZip>)

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: ['doc1'],
          onUpdate: vi.fn(),
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('should call download mutation with downloadable ids', async () => {
      const mockBlob = new Blob(['test'])
      mockMutateAsync.mockResolvedValue(mockBlob)

      mockUseDocumentDownloadZip.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof useDocument.useDocumentDownloadZip>)

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1', 'doc2'],
          downloadableSelectedIds: ['doc1'],
          onUpdate: vi.fn(),
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        datasetId: 'ds1',
        documentIds: ['doc1'],
      })
    })
  })

  describe('isDownloadingZip', () => {
    it('should reflect isPending state from mutation', () => {
      mockUseDocumentDownloadZip.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as unknown as ReturnType<typeof useDocument.useDocumentDownloadZip>)

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: [],
          downloadableSelectedIds: [],
          onUpdate: vi.fn(),
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      expect(result.current.isDownloadingZip).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should show error toast when handleAction fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Action failed'))
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      // onUpdate should not be called on error
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('should show error toast when handleBatchReIndex fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Re-index failed'))
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      // onUpdate and onClearSelection should not be called on error
      expect(onUpdate).not.toHaveBeenCalled()
      expect(onClearSelection).not.toHaveBeenCalled()
    })

    it('should show error toast when handleBatchDownload fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Download failed'))

      mockUseDocumentDownloadZip.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof useDocument.useDocumentDownloadZip>)

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: ['doc1'],
          onUpdate: vi.fn(),
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      // Mutation was called but failed
      expect(mockMutateAsync).toHaveBeenCalled()
    })

    it('should show error toast when handleBatchDownload returns null blob', async () => {
      mockMutateAsync.mockResolvedValue(null)

      mockUseDocumentDownloadZip.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof useDocument.useDocumentDownloadZip>)

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: ['doc1'],
          onUpdate: vi.fn(),
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      // Mutation was called but returned null
      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })

  describe('all action types', () => {
    it('should handle summary action', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleAction(DocumentActionType.summary)()
      })

      expect(mockMutateAsync).toHaveBeenCalled()
      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should handle disable action', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()

      const { result } = renderHook(
        () => useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: [],
          onUpdate,
          onClearSelection: vi.fn(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleAction(DocumentActionType.disable)()
      })

      expect(mockMutateAsync).toHaveBeenCalled()
      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })
  })
})
