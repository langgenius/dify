import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DocumentActionType } from '@/models/datasets'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useDocumentActions } from '../use-document-actions'

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

const mockArchive = vi.fn()
const mockSummary = vi.fn()
const mockEnable = vi.fn()
const mockDisable = vi.fn()
const mockDelete = vi.fn()
const mockRetryIndex = vi.fn()
const mockDownloadZip = vi.fn()

const statusMocks: Record<string, (input: unknown) => unknown> = {
  archive: (input) => mockArchive(input),
  enable: (input) => mockEnable(input),
  disable: (input) => mockDisable(input),
}

vi.mock('@/app/notifications', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

const mockDownloadBlob = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.status.byAction.batch.patch': (input: {
        params: { action: string }
      }) => statusMocks[input.params.action]!(input),
      'datasets.byDatasetId.documents.generateSummary.post': (input) => mockSummary(input),
      'datasets.byDatasetId.documents.delete': (input) => mockDelete(input),
      'datasets.byDatasetId.retry.post': (input) => mockRetryIndex(input),
    }),
  }
})

describe('useDocumentActions', () => {
  const defaultOptions = {
    datasetId: 'ds-1',
    selectedIds: ['doc-1', 'doc-2'],
    selectedDocuments: [
      { id: 'doc-1', indexing_retry_action: 'retry' as const },
      { id: 'doc-2', indexing_retry_action: 'retry' as const },
    ],
    downloadableSelectedIds: ['doc-1'],
    onUpdate: vi.fn(),
    onClearSelection: vi.fn(),
    onRemoveFromSelection: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleAction', () => {
    it('should call archive API and show success toast', async () => {
      mockArchive.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      expect(mockArchive).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1', action: 'archive' },
        query: { document_id: ['doc-1', 'doc-2'] },
      })
      expect(mockToastSuccess).toHaveBeenCalledWith(expect.any(String))
      expect(defaultOptions.onUpdate).toHaveBeenCalled()
      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
    })

    it('should call enable API on enable action', async () => {
      mockEnable.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.enable)()
      })

      expect(mockEnable).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1', action: 'enable' },
        query: { document_id: ['doc-1', 'doc-2'] },
      })
      expect(defaultOptions.onUpdate).toHaveBeenCalled()
    })

    it('should call disable API on disable action', async () => {
      mockDisable.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.disable)()
      })

      expect(mockDisable).toHaveBeenCalled()
    })

    it('should call summary API on summary action', async () => {
      mockSummary.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.summary)()
      })

      expect(mockSummary).toHaveBeenCalled()
    })

    it('should call onClearSelection on delete action success', async () => {
      mockDelete.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.delete)()
      })

      expect(mockDelete).toHaveBeenCalled()
      expect(defaultOptions.onClearSelection).toHaveBeenCalled()
      expect(defaultOptions.onUpdate).toHaveBeenCalled()
    })

    it('should show error toast on action failure', async () => {
      mockArchive.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      expect(mockToastError).toHaveBeenCalledWith(expect.any(String))
      expect(defaultOptions.onRemoveFromSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('handleBatchReIndex', () => {
    it('should call retry index API and show success toast', async () => {
      mockRetryIndex.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      expect(mockRetryIndex).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1' },
        body: { document_ids: ['doc-1', 'doc-2'] },
      })
      expect(defaultOptions.onRemoveFromSelection).toHaveBeenCalledExactlyOnceWith([
        'doc-1',
        'doc-2',
      ])
      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onUpdate).toHaveBeenCalled()
    })

    it('should show error toast on reindex failure', async () => {
      mockRetryIndex.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      expect(mockToastError).toHaveBeenCalledWith(expect.any(String))
      expect(defaultOptions.onRemoveFromSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onUpdate).not.toHaveBeenCalled()
    })

    it('groups a mixed selection by the server retry action', async () => {
      mockRetryIndex.mockResolvedValue({ result: 'success' })
      mockEnable.mockResolvedValue({ result: 'success' })
      mockDisable.mockResolvedValue({ result: 'success' })
      mockArchive.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() =>
        useDocumentActions({
          ...defaultOptions,
          selectedIds: ['doc-retry', 'doc-enable', 'doc-disable', 'doc-archive', 'doc-completed'],
          selectedDocuments: [
            { id: 'doc-retry', indexing_retry_action: 'retry' },
            { id: 'doc-enable', indexing_retry_action: 'enable' },
            { id: 'doc-disable', indexing_retry_action: 'disable' },
            { id: 'doc-archive', indexing_retry_action: 'archive' },
            { id: 'doc-completed', indexing_retry_action: null },
          ],
        }),
      )

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      expect(mockRetryIndex).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'ds-1' },
        body: { document_ids: ['doc-retry'] },
      })
      expect(mockEnable).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'ds-1', action: 'enable' },
        query: { document_id: ['doc-enable'] },
      })
      expect(mockDisable).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'ds-1', action: 'disable' },
        query: { document_id: ['doc-disable'] },
      })
      expect(mockArchive).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'ds-1', action: 'archive' },
        query: { document_id: ['doc-archive'] },
      })
      expect(defaultOptions.onRemoveFromSelection).toHaveBeenCalledExactlyOnceWith([
        'doc-retry',
        'doc-enable',
        'doc-disable',
        'doc-archive',
      ])
      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
    })

    it('does not report success or mutate selection when no selected document is recoverable', async () => {
      const { result } = renderHook(() =>
        useDocumentActions({
          ...defaultOptions,
          selectedIds: ['doc-disabled', 'doc-archived'],
          selectedDocuments: [
            { id: 'doc-disabled', indexing_retry_action: null },
            { id: 'doc-archived', indexing_retry_action: null },
          ],
        }),
      )

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      expect(mockRetryIndex).not.toHaveBeenCalled()
      expect(mockEnable).not.toHaveBeenCalled()
      expect(mockDisable).not.toHaveBeenCalled()
      expect(mockArchive).not.toHaveBeenCalled()
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(defaultOptions.onRemoveFromSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
      expect(defaultOptions.onUpdate).not.toHaveBeenCalled()
    })
  })

  it('tracks the download request while the archive is being prepared', async () => {
    const pending = createDeferred<Blob>()
    mockDownloadZip.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useDocumentActions(defaultOptions))
    let download: Promise<void>
    act(() => {
      download = result.current.handleBatchDownload()
    })
    await waitFor(() => expect(result.current.isDownloadingZip).toBe(true))
    await act(async () => {
      await result.current.handleBatchDownload()
    })
    expect(mockDownloadZip).toHaveBeenCalledOnce()
    await act(async () => {
      pending.resolve(new Blob(['archive']))
      await download
    })
    await waitFor(() => expect(result.current.isDownloadingZip).toBe(false))
  })
  describe('handleBatchDownload', () => {
    it('should download blob on success', async () => {
      const blob = new Blob(['test'])
      mockDownloadZip.mockResolvedValue(blob)
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      expect(mockDownloadZip).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        documentIds: ['doc-1'],
      })
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          data: blob,
          fileName: expect.stringContaining('-docs.zip'),
        }),
      )
    })

    it('should show error toast on download failure', async () => {
      mockDownloadZip.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      expect(mockToastError).toHaveBeenCalledWith(expect.any(String))
    })
  })
})

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  downloadDocumentsZip: (...args: unknown[]) => mockDownloadZip(...args),
}))
