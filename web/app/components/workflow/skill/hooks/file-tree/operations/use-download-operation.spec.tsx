import { act, renderHook, waitFor } from '@testing-library/react'
import { useDownloadOperation } from './use-download-operation'

type DownloadRequest = {
  params: {
    appId: string
    nodeId: string
  }
}

type DownloadResponse = {
  download_url: string
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
  mockDownloadUrl,
  mockToastNotify,
} = vi.hoisted(() => ({
  mockGetFileDownloadUrl: vi.fn<(request: DownloadRequest) => Promise<DownloadResponse>>(),
  mockDownloadUrl: vi.fn<(payload: { url: string, fileName?: string }) => void>(),
  mockToastNotify: vi.fn<(payload: { type: string, message: string }) => void>(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    appAsset: {
      getFileDownloadUrl: mockGetFileDownloadUrl,
    },
  },
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: mockDownloadUrl,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockToastNotify,
  },
}))

describe('useDownloadOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFileDownloadUrl.mockResolvedValue({ download_url: 'https://example.com/file.txt' })
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

  // Scenario: successful downloads should fetch URL and trigger browser download.
  describe('Success', () => {
    it('should download file when API call succeeds', async () => {
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
      expect(mockGetFileDownloadUrl).toHaveBeenCalledWith({
        params: {
          appId: 'app-1',
          nodeId: 'node-1',
        },
      })
      expect(mockDownloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/file.txt',
        fileName: 'notes.md',
      })
      expect(mockToastNotify).not.toHaveBeenCalled()
      expect(result.current.isDownloading).toBe(false)
    })

    it('should set isDownloading true while download request is pending', async () => {
      const deferred = createDeferred<DownloadResponse>()
      mockGetFileDownloadUrl.mockReturnValueOnce(deferred.promise)
      const onClose = vi.fn()

      const { result } = renderHook(() => useDownloadOperation({
        appId: 'app-2',
        nodeId: 'node-2',
        onClose,
      }))

      act(() => {
        void result.current.handleDownload()
      })

      await waitFor(() => {
        expect(result.current.isDownloading).toBe(true)
      })

      await act(async () => {
        deferred.resolve({ download_url: 'https://example.com/slow.txt' })
        await deferred.promise
      })

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(mockDownloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/slow.txt',
        fileName: undefined,
      })
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
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.downloadError',
      })
      expect(result.current.isDownloading).toBe(false)
    })
  })
})
