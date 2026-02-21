import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentActionType } from '@/models/datasets'
import { useDocumentActions } from '../use-document-actions'

const mockArchive = vi.fn()
const mockSummary = vi.fn()
const mockEnable = vi.fn()
const mockDisable = vi.fn()
const mockDelete = vi.fn()
const mockRetryIndex = vi.fn()
const mockDownloadZip = vi.fn()
let mockIsDownloadingZip = false

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentArchive: () => ({ mutateAsync: mockArchive }),
  useDocumentSummary: () => ({ mutateAsync: mockSummary }),
  useDocumentEnable: () => ({ mutateAsync: mockEnable }),
  useDocumentDisable: () => ({ mutateAsync: mockDisable }),
  useDocumentDelete: () => ({ mutateAsync: mockDelete }),
  useDocumentBatchRetryIndex: () => ({ mutateAsync: mockRetryIndex }),
  useDocumentDownloadZip: () => ({ mutateAsync: mockDownloadZip, isPending: mockIsDownloadingZip }),
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: { notify: (...args: unknown[]) => mockToastNotify(...args) },
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
    mockIsDownloadingZip = false
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
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' }),
      )
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

      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
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

      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
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

      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should show error toast when blob is null', async () => {
      mockDownloadZip.mockResolvedValue(null)
      const { result } = renderHook(() => useDocumentActions(defaultOptions))

      await act(async () => {
        await result.current.handleBatchDownload()
      })

      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })
  })
})
