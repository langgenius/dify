import { act, renderHook, waitFor } from '@testing-library/react'
import { useDownloadOperation } from '.././use-download-operation'

type DownloadRequest = {
  params: {
    appId: string
    nodeId: string
  }
}

type DownloadResponse = {
  download_url: string
}

type FileContentResponse = {
  content: string
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const {
  mockGetFileDownloadUrl,
  mockGetFileContent,
  mockDownloadUrl,
  mockDownloadBlob,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetFileDownloadUrl: vi.fn<(request: DownloadRequest) => Promise<DownloadResponse>>(),
  mockGetFileContent: vi.fn<(request: DownloadRequest) => Promise<FileContentResponse>>(),
  mockDownloadUrl: vi.fn<(payload: { url: string, fileName?: string }) => void>(),
  mockDownloadBlob: vi.fn<(payload: { data: Blob, fileName: string }) => void>(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    appAsset: {
      getFileDownloadUrl: mockGetFileDownloadUrl,
      getFileContent: mockGetFileContent,
    },
  },
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: mockDownloadUrl,
  downloadBlob: mockDownloadBlob,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

describe('useDownloadOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFileDownloadUrl.mockResolvedValue({ download_url: 'https://example.com/file.txt' })
    mockGetFileContent.mockResolvedValue({ content: '{"content":"# Skill\\n\\nOriginal markdown"}' })
  })

  // Scenario: hook should no-op when required identifiers are missing.
  describe('Guards', () => {
    it('should not call download API when appId or nodeId is missing', async () => {
      const onClose = vi.fn()
      const { result } = renderHook(() => useDownloadOperation({
        appId: '',
        nodeId: '',
        onClose,
      }))

      await act(async () => {
        await result.current.handleDownload()
      })

      expect(onClose).not.toHaveBeenCalled()
      expect(mockGetFileDownloadUrl).not.toHaveBeenCalled()
      expect(mockDownloadUrl).not.toHaveBeenCalled()
      expect(result.current.isDownloading).toBe(false)
    })
  })

  // Scenario: successful downloads should unwrap text files and keep binary downloads on URL flow.
  describe('Success', () => {
    it('should download text file from raw content when file is markdown', async () => {
      const onClose = vi.fn()
      const { result } = renderHook(() => useDownloadOperation({
        appId: 'app-1',
        nodeId: 'node-1',
        fileName: 'notes.md',
        onClose,
      }))

      await act(async () => {
        await result.current.handleDownload()
      })

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(mockGetFileContent).toHaveBeenCalledWith({
        params: {
          appId: 'app-1',
          nodeId: 'node-1',
        },
      })
      expect(mockGetFileDownloadUrl).not.toHaveBeenCalled()
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
        fileName: 'notes.md',
      }))
      const downloadedBlob = mockDownloadBlob.mock.calls[0][0].data
      await expect(downloadedBlob.text()).resolves.toBe('# Skill\n\nOriginal markdown')
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(mockToastError).not.toHaveBeenCalled()
      expect(result.current.isDownloading).toBe(false)
    })

    it('should preserve raw content when parsed text payload has no content field', async () => {
      mockGetFileContent.mockResolvedValueOnce({ content: '{"title":"Skill"}' })
      const onClose = vi.fn()
      const { result } = renderHook(() => useDownloadOperation({
        appId: 'app-1',
        nodeId: 'node-raw',
        fileName: 'config.json',
        onClose,
      }))

      await act(async () => {
        await result.current.handleDownload()
      })

      const downloadedBlob = mockDownloadBlob.mock.calls.at(-1)?.[0].data
      await expect(downloadedBlob?.text()).resolves.toBe('{"title":"Skill"}')
      expect(mockDownloadUrl).not.toHaveBeenCalled()
    })

    it('should download binary file from download url when file is not text', async () => {
      const onClose = vi.fn()
      const { result } = renderHook(() => useDownloadOperation({
        appId: 'app-1',
        nodeId: 'node-1',
        fileName: 'diagram.png',
        onClose,
      }))

      await act(async () => {
        await result.current.handleDownload()
      })

      expect(mockGetFileDownloadUrl).toHaveBeenCalledWith({
        params: {
          appId: 'app-1',
          nodeId: 'node-1',
        },
      })
      expect(mockGetFileContent).not.toHaveBeenCalled()
      expect(mockDownloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/file.txt',
        fileName: 'diagram.png',
      })
      expect(mockDownloadBlob).not.toHaveBeenCalled()
    })

    it('should set isDownloading true while download request is pending', async () => {
      const deferred = createDeferred<FileContentResponse>()
      mockGetFileContent.mockReturnValueOnce(deferred.promise)
      const onClose = vi.fn()

      const { result } = renderHook(() => useDownloadOperation({
        appId: 'app-2',
        nodeId: 'node-2',
        fileName: 'notes.md',
        onClose,
      }))

      act(() => {
        void result.current.handleDownload()
      })

      await waitFor(() => {
        expect(result.current.isDownloading).toBe(true)
      })

      await act(async () => {
        deferred.resolve({ content: '{"content":"slow"}' })
        await deferred.promise
      })

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
        fileName: 'notes.md',
      }))
      expect(result.current.isDownloading).toBe(false)
    })
  })

  // Scenario: failed downloads should notify users and reset loading state.
  describe('Error handling', () => {
    it('should show error toast when download API fails', async () => {
      mockGetFileDownloadUrl.mockRejectedValueOnce(new Error('network failure'))
      const onClose = vi.fn()
      const { result } = renderHook(() => useDownloadOperation({
        appId: 'app-3',
        nodeId: 'node-3',
        onClose,
      }))

      await act(async () => {
        await result.current.handleDownload()
      })

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(mockDownloadUrl).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('workflow.skillSidebar.menu.downloadError')
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(result.current.isDownloading).toBe(false)
    })
  })
})
