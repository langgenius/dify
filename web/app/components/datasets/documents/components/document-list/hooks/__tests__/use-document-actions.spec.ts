import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DocumentActionType } from '@/models/datasets'
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

vi.mock('@/service/knowledge/use-document', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const { createTestQueryClient } = await import('@/test/query-client')
  const mutationClient = createTestQueryClient()
  return {
    useDocumentArchive: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockArchive(variables), ...options },
        mutationClient,
      ),
    useDocumentSummary: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockSummary(variables), ...options },
        mutationClient,
      ),
    useDocumentEnable: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockEnable(variables), ...options },
        mutationClient,
      ),
    useDocumentDisable: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockDisable(variables), ...options },
        mutationClient,
      ),
    useDocumentDelete: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockDelete(variables), ...options },
        mutationClient,
      ),
    useDocumentBatchRetryIndex: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockRetryIndex(variables), ...options },
        mutationClient,
      ),
    useDocumentDownloadZip: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockDownloadZip(variables), ...options },
        mutationClient,
      ),
  }
})

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

describe('useDocumentActions', () => {
  const defaultOptions = {
    datasetId: 'ds-1',
    selectedIds: ['doc-1', 'doc-2'],
    downloadableSelectedIds: ['doc-1'],
    onUpdate: vi.fn(),
    onClearSelection: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return expected functions and state', () => {
    const { result } = renderHook(() => useDocumentActions(defaultOptions))
    expect(result.current.handleAction).toBeInstanceOf(Function)
    expect(result.current.handleBatchReIndex).toBeInstanceOf(Function)
    expect(result.current.handleBatchDownload).toBeInstanceOf(Function)
    expect(typeof result.current.isDownloadingZip).toBe('boolean')
  })

  describe('handleAction', () => {
    it('should call archive API and show success toast', async () => {
      mockArchive.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      expect(mockArchive).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        documentIds: ['doc-1', 'doc-2'],
      })
      expect(mockToastSuccess).toHaveBeenCalledWith(expect.any(String))
      expect(defaultOptions.onUpdate).toHaveBeenCalled()
    })

    it('should call enable API on enable action', async () => {
      mockEnable.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.enable)()
      })

      expect(mockEnable).toHaveBeenCalledWith({
        datasetId: 'ds-1',
        documentIds: ['doc-1', 'doc-2'],
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

    it('should not call onClearSelection on non-delete action success', async () => {
      mockArchive.mockResolvedValue({ result: 'success' })
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
    })

    it('should show error toast on action failure', async () => {
      mockArchive.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleAction(DocumentActionType.archive)()
      })

      expect(mockToastError).toHaveBeenCalledWith(expect.any(String))
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
        datasetId: 'ds-1',
        documentIds: ['doc-1', 'doc-2'],
      })
      expect(defaultOptions.onClearSelection).toHaveBeenCalled()
      expect(defaultOptions.onUpdate).toHaveBeenCalled()
    })

    it('should show error toast on reindex failure', async () => {
      mockRetryIndex.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchReIndex()
      })

      expect(mockToastError).toHaveBeenCalledWith(expect.any(String))
    })
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

    it('should show error toast when blob is null', async () => {
      mockDownloadZip.mockResolvedValue(null)
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      expect(mockToastError).toHaveBeenCalledWith(expect.any(String))
    })
  })
  it.each([
    [DocumentActionType.summary, mockSummary],
    [DocumentActionType.enable, mockEnable],
    [DocumentActionType.disable, mockDisable],
    [DocumentActionType.delete, mockDelete],
  ] as const)('preserves selection and reports failed %s once', async (action, request) => {
    request.mockRejectedValueOnce(new Error('Batch action failed'))
    const { result } = renderHook(() => useDocumentActions(defaultOptions))
    await act(async () => {
      await result.current.handleAction(action)()
    })
    expect(mockToastError).toHaveBeenCalledExactlyOnceWith(
      'common.actionMsg.modifiedUnsuccessfully',
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(defaultOptions.onClearSelection).not.toHaveBeenCalled()
    expect(defaultOptions.onUpdate).not.toHaveBeenCalled()
  })
})
