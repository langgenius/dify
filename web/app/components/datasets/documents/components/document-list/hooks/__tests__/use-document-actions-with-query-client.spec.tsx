import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DocumentActionType } from '@/models/datasets'
import { createDeferred } from '@/test/deferred'
import { useDocumentActions } from '../use-document-actions'

const { mockMutateAsync } = vi.hoisted(() => ({ mockMutateAsync: vi.fn() }))

const createConsoleQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

const createWrapper = () => {
  const queryClient = createConsoleQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.status.byAction.batch.patch': mockMutateAsync,
      'datasets.byDatasetId.documents.generateSummary.post': mockMutateAsync,
      'datasets.byDatasetId.documents.delete': mockMutateAsync,
      'datasets.byDatasetId.retry.post': mockMutateAsync,
    }),
  }
})

describe('useDocumentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleAction', () => {
    it('should call archive mutation when archive action is triggered', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () =>
          useDocumentActions({
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
        params: { dataset_id: 'ds1', action: 'archive' },
        query: { document_id: ['doc1'] },
      })
    })

    it('should call onUpdate on successful action', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () =>
          useDocumentActions({
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
        () =>
          useDocumentActions({
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
        () =>
          useDocumentActions({
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
        params: { dataset_id: 'ds1' },
        body: { document_ids: ['doc1', 'doc2'] },
      })
    })

    it('should call onClearSelection on success', async () => {
      mockMutateAsync.mockResolvedValue({ result: 'success' })
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () =>
          useDocumentActions({
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
    it('should call download mutation with downloadable ids', async () => {
      const mockBlob = new Blob(['test'])
      mockMutateAsync.mockResolvedValue(mockBlob)

      const { result } = renderHook(
        () =>
          useDocumentActions({
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

  it('tracks the download request while the archive is being prepared', async () => {
    const pending = createDeferred<Blob>()
    mockMutateAsync.mockReturnValue(pending.promise)
    const { result } = renderHook(
      () =>
        useDocumentActions({
          datasetId: 'ds1',
          selectedIds: ['doc1'],
          downloadableSelectedIds: ['doc1'],
          onUpdate: vi.fn(),
          onClearSelection: vi.fn(),
        }),
      { wrapper: createWrapper() },
    )
    let download: Promise<void>
    act(() => {
      download = result.current.handleBatchDownload()
    })
    await waitFor(() => expect(result.current.isDownloadingZip).toBe(true))
    await act(async () => {
      await result.current.handleBatchDownload()
    })
    expect(mockMutateAsync).toHaveBeenCalledOnce()
    await act(async () => {
      pending.resolve(new Blob(['archive']))
      await download
    })
    await waitFor(() => expect(result.current.isDownloadingZip).toBe(false))
  })

  describe('error handling', () => {
    it('should show error toast when handleAction fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Action failed'))
      const onUpdate = vi.fn()
      const onClearSelection = vi.fn()

      const { result } = renderHook(
        () =>
          useDocumentActions({
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
        () =>
          useDocumentActions({
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

      const { result } = renderHook(
        () =>
          useDocumentActions({
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

      const { result } = renderHook(
        () =>
          useDocumentActions({
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
        () =>
          useDocumentActions({
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
        () =>
          useDocumentActions({
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

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  downloadDocumentsZip: mockMutateAsync,
}))
