import type { FileEntity } from './types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileUploadConfigResponse } from '@/models/common'
import { act, renderHook } from '@testing-library/react'
import { useFile, useFileSizeLimit } from './hooks'

const mockNotify = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: undefined }),
}))

// Exception: hook requires toast context that isn't available without a provider wrapper
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

const mockSetFiles = vi.fn()
let mockStoreFiles: FileEntity[] = []
vi.mock('./store', () => ({
  useFileStore: () => ({
    getState: () => ({
      files: mockStoreFiles,
      setFiles: mockSetFiles,
    }),
  }),
}))

const mockFileUpload = vi.fn()
const mockIsAllowedFileExtension = vi.fn().mockReturnValue(true)
const mockGetSupportFileType = vi.fn().mockReturnValue('document')
vi.mock('./utils', () => ({
  fileUpload: (...args: unknown[]) => mockFileUpload(...args),
  getFileUploadErrorMessage: vi.fn().mockReturnValue('Upload error'),
  getSupportFileType: (...args: unknown[]) => mockGetSupportFileType(...args),
  isAllowedFileExtension: (...args: unknown[]) => mockIsAllowedFileExtension(...args),
}))

const mockUploadRemoteFileInfo = vi.fn()
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: (...args: unknown[]) => mockUploadRemoteFileInfo(...args),
}))

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}))

describe('useFileSizeLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return default limits when no config is provided', () => {
    const { result } = renderHook(() => useFileSizeLimit())

    expect(result.current.imgSizeLimit).toBe(10 * 1024 * 1024)
    expect(result.current.docSizeLimit).toBe(15 * 1024 * 1024)
    expect(result.current.audioSizeLimit).toBe(50 * 1024 * 1024)
    expect(result.current.videoSizeLimit).toBe(100 * 1024 * 1024)
    expect(result.current.maxFileUploadLimit).toBe(10)
  })

  it('should use config values when provided', () => {
    const config: FileUploadConfigResponse = {
      image_file_size_limit: 20,
      file_size_limit: 30,
      audio_file_size_limit: 100,
      video_file_size_limit: 200,
      workflow_file_upload_limit: 20,
    } as FileUploadConfigResponse

    const { result } = renderHook(() => useFileSizeLimit(config))

    expect(result.current.imgSizeLimit).toBe(20 * 1024 * 1024)
    expect(result.current.docSizeLimit).toBe(30 * 1024 * 1024)
    expect(result.current.audioSizeLimit).toBe(100 * 1024 * 1024)
    expect(result.current.videoSizeLimit).toBe(200 * 1024 * 1024)
    expect(result.current.maxFileUploadLimit).toBe(20)
  })

  it('should fall back to defaults when config values are zero', () => {
    const config = {
      image_file_size_limit: 0,
      file_size_limit: 0,
      audio_file_size_limit: 0,
      video_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    } as FileUploadConfigResponse

    const { result } = renderHook(() => useFileSizeLimit(config))

    expect(result.current.imgSizeLimit).toBe(10 * 1024 * 1024)
    expect(result.current.docSizeLimit).toBe(15 * 1024 * 1024)
    expect(result.current.audioSizeLimit).toBe(50 * 1024 * 1024)
    expect(result.current.videoSizeLimit).toBe(100 * 1024 * 1024)
    expect(result.current.maxFileUploadLimit).toBe(10)
  })
})

describe('useFile', () => {
  const defaultFileConfig: FileUpload = {
    enabled: true,
    allowed_file_types: ['image', 'document'],
    allowed_file_extensions: [],
    number_limits: 5,
  } as FileUpload

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreFiles = []
    mockIsAllowedFileExtension.mockReturnValue(true)
    mockGetSupportFileType.mockReturnValue('document')
  })

  it('should return all file handler functions', () => {
    const { result } = renderHook(() => useFile(defaultFileConfig))

    expect(result.current.handleAddFile).toBeDefined()
    expect(result.current.handleUpdateFile).toBeDefined()
    expect(result.current.handleRemoveFile).toBeDefined()
    expect(result.current.handleReUploadFile).toBeDefined()
    expect(result.current.handleLoadFileFromLink).toBeDefined()
    expect(result.current.handleLoadFileFromLinkSuccess).toBeDefined()
    expect(result.current.handleLoadFileFromLinkError).toBeDefined()
    expect(result.current.handleClearFiles).toBeDefined()
    expect(result.current.handleLocalFileUpload).toBeDefined()
    expect(result.current.handleClipboardPasteFile).toBeDefined()
    expect(result.current.handleDragFileEnter).toBeDefined()
    expect(result.current.handleDragFileOver).toBeDefined()
    expect(result.current.handleDragFileLeave).toBeDefined()
    expect(result.current.handleDropFile).toBeDefined()
    expect(result.current.isDragActive).toBe(false)
  })

  it('should add a file via handleAddFile', () => {
    const { result } = renderHook(() => useFile(defaultFileConfig))

    result.current.handleAddFile({
      id: 'test-id',
      name: 'test.txt',
      type: 'text/plain',
      size: 100,
      progress: 0,
      transferMethod: 'local_file',
      supportFileType: 'document',
    } as FileEntity)
    expect(mockSetFiles).toHaveBeenCalled()
  })

  it('should update a file via handleUpdateFile', () => {
    mockStoreFiles = [{ id: 'file-1', name: 'a.txt', progress: 0 }] as FileEntity[]
    const { result } = renderHook(() => useFile(defaultFileConfig))

    result.current.handleUpdateFile({ id: 'file-1', name: 'a.txt', progress: 50 } as FileEntity)
    expect(mockSetFiles).toHaveBeenCalled()
  })

  it('should not update file when id is not found', () => {
    mockStoreFiles = [{ id: 'file-1', name: 'a.txt' }] as FileEntity[]
    const { result } = renderHook(() => useFile(defaultFileConfig))

    result.current.handleUpdateFile({ id: 'nonexistent' } as FileEntity)
    expect(mockSetFiles).toHaveBeenCalled()
  })

  it('should remove a file via handleRemoveFile', () => {
    mockStoreFiles = [{ id: 'file-1', name: 'a.txt' }] as FileEntity[]
    const { result } = renderHook(() => useFile(defaultFileConfig))

    result.current.handleRemoveFile('file-1')
    expect(mockSetFiles).toHaveBeenCalled()
  })

  it('should clear all files via handleClearFiles', () => {
    mockStoreFiles = [{ id: 'a' }] as FileEntity[]
    const { result } = renderHook(() => useFile(defaultFileConfig))

    result.current.handleClearFiles()
    expect(mockSetFiles).toHaveBeenCalledWith([])
  })

  describe('handleReUploadFile', () => {
    it('should re-upload a file and call fileUpload', () => {
      const originalFile = new File(['content'], 'test.txt', { type: 'text/plain' })
      mockStoreFiles = [{
        id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        size: 100,
        progress: -1,
        transferMethod: 'local_file',
        supportFileType: 'document',
        originalFile,
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))

      result.current.handleReUploadFile('file-1')
      expect(mockSetFiles).toHaveBeenCalled()
      expect(mockFileUpload).toHaveBeenCalled()
    })

    it('should not re-upload when file id is not found', () => {
      mockStoreFiles = []
      const { result } = renderHook(() => useFile(defaultFileConfig))

      result.current.handleReUploadFile('nonexistent')
      expect(mockFileUpload).not.toHaveBeenCalled()
    })

    it('should handle progress callback during re-upload', () => {
      const originalFile = new File(['content'], 'test.txt', { type: 'text/plain' })
      mockStoreFiles = [{
        id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        size: 100,
        progress: -1,
        transferMethod: 'local_file',
        supportFileType: 'document',
        originalFile,
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleReUploadFile('file-1')

      const uploadCall = mockFileUpload.mock.calls[0][0]
      uploadCall.onProgressCallback(50)
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should handle success callback during re-upload', () => {
      const originalFile = new File(['content'], 'test.txt', { type: 'text/plain' })
      mockStoreFiles = [{
        id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        size: 100,
        progress: -1,
        transferMethod: 'local_file',
        supportFileType: 'document',
        originalFile,
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleReUploadFile('file-1')

      const uploadCall = mockFileUpload.mock.calls[0][0]
      uploadCall.onSuccessCallback({ id: 'uploaded-1' })
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should handle error callback during re-upload', () => {
      const originalFile = new File(['content'], 'test.txt', { type: 'text/plain' })
      mockStoreFiles = [{
        id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        size: 100,
        progress: -1,
        transferMethod: 'local_file',
        supportFileType: 'document',
        originalFile,
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleReUploadFile('file-1')

      const uploadCall = mockFileUpload.mock.calls[0][0]
      uploadCall.onErrorCallback(new Error('fail'))
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
  })

  describe('handleLoadFileFromLink', () => {
    it('should run startProgressTimer to increment file progress', () => {
      vi.useFakeTimers()
      mockUploadRemoteFileInfo.mockReturnValue(new Promise(() => {})) // never resolves

      // Set up a file in the store that has progress 0
      mockStoreFiles = [{
        id: 'mock-uuid',
        name: 'https://example.com/file.txt',
        type: '',
        size: 0,
        progress: 0,
        transferMethod: 'remote_url',
        supportFileType: '',
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLoadFileFromLink('https://example.com/file.txt')

      // Advance timer to trigger the interval
      vi.advanceTimersByTime(200)
      expect(mockSetFiles).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should add file and call uploadRemoteFileInfo', () => {
      mockUploadRemoteFileInfo.mockResolvedValue({
        id: 'remote-1',
        mime_type: 'text/plain',
        size: 100,
        name: 'remote.txt',
        url: 'https://example.com/remote.txt',
      })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLoadFileFromLink('https://example.com/file.txt')

      expect(mockSetFiles).toHaveBeenCalled()
      expect(mockUploadRemoteFileInfo).toHaveBeenCalledWith('https://example.com/file.txt', false)
    })

    it('should remove file when extension is not allowed', async () => {
      mockIsAllowedFileExtension.mockReturnValue(false)
      mockUploadRemoteFileInfo.mockResolvedValue({
        id: 'remote-1',
        mime_type: 'text/plain',
        size: 100,
        name: 'remote.txt',
        url: 'https://example.com/remote.txt',
      })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      await act(async () => {
        result.current.handleLoadFileFromLink('https://example.com/file.txt')
        await vi.waitFor(() => expect(mockUploadRemoteFileInfo).toHaveBeenCalled())
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should use empty arrays when allowed_file_types and allowed_file_extensions are undefined', async () => {
      mockIsAllowedFileExtension.mockReturnValue(false)
      mockUploadRemoteFileInfo.mockResolvedValue({
        id: 'remote-1',
        mime_type: 'text/plain',
        size: 100,
        name: 'remote.txt',
        url: 'https://example.com/remote.txt',
      })

      const configWithUndefined = {
        ...defaultFileConfig,
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      } as unknown as FileUpload

      const { result } = renderHook(() => useFile(configWithUndefined))
      await act(async () => {
        result.current.handleLoadFileFromLink('https://example.com/file.txt')
        await vi.waitFor(() => expect(mockUploadRemoteFileInfo).toHaveBeenCalled())
      })

      expect(mockIsAllowedFileExtension).toHaveBeenCalledWith('remote.txt', 'text/plain', [], [])
    })

    it('should remove file when remote upload fails', async () => {
      mockUploadRemoteFileInfo.mockRejectedValue(new Error('network error'))

      const { result } = renderHook(() => useFile(defaultFileConfig))
      await act(async () => {
        result.current.handleLoadFileFromLink('https://example.com/file.txt')
        await vi.waitFor(() => expect(mockNotify).toHaveBeenCalled())
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should remove file when size limit is exceeded on remote upload', async () => {
      mockGetSupportFileType.mockReturnValue('image')
      mockUploadRemoteFileInfo.mockResolvedValue({
        id: 'remote-1',
        mime_type: 'image/png',
        size: 20 * 1024 * 1024,
        name: 'large.png',
        url: 'https://example.com/large.png',
      })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      await act(async () => {
        result.current.handleLoadFileFromLink('https://example.com/large.png')
        await vi.waitFor(() => expect(mockUploadRemoteFileInfo).toHaveBeenCalled())
      })

      // File should be removed because image exceeds 10MB limit
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should update file on successful remote upload within limits', async () => {
      mockUploadRemoteFileInfo.mockResolvedValue({
        id: 'remote-1',
        mime_type: 'text/plain',
        size: 100,
        name: 'remote.txt',
        url: 'https://example.com/remote.txt',
      })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      await act(async () => {
        result.current.handleLoadFileFromLink('https://example.com/remote.txt')
        await vi.waitFor(() => expect(mockUploadRemoteFileInfo).toHaveBeenCalled())
      })

      // setFiles should be called: once for add, once for update
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should stop progress timer when file reaches 80 percent', () => {
      vi.useFakeTimers()
      mockUploadRemoteFileInfo.mockReturnValue(new Promise(() => {}))

      // Set up a file already at 80% progress
      mockStoreFiles = [{
        id: 'mock-uuid',
        name: 'https://example.com/file.txt',
        type: '',
        size: 0,
        progress: 80,
        transferMethod: 'remote_url',
        supportFileType: '',
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLoadFileFromLink('https://example.com/file.txt')

      // At progress 80, the timer should stop (clearTimeout path)
      vi.advanceTimersByTime(200)

      vi.useRealTimers()
    })

    it('should stop progress timer when progress is negative', () => {
      vi.useFakeTimers()
      mockUploadRemoteFileInfo.mockReturnValue(new Promise(() => {}))

      // Set up a file with negative progress (error state)
      mockStoreFiles = [{
        id: 'mock-uuid',
        name: 'https://example.com/file.txt',
        type: '',
        size: 0,
        progress: -1,
        transferMethod: 'remote_url',
        supportFileType: '',
      }] as FileEntity[]

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLoadFileFromLink('https://example.com/file.txt')

      vi.advanceTimersByTime(200)

      vi.useRealTimers()
    })
  })

  describe('handleLocalFileUpload', () => {
    let capturedListeners: Record<string, (() => void)[]>
    let mockReaderResult: string | null

    beforeEach(() => {
      capturedListeners = {}
      mockReaderResult = 'data:text/plain;base64,Y29udGVudA=='

      class MockFileReader {
        result: string | null = null
        addEventListener(event: string, handler: () => void) {
          if (!capturedListeners[event])
            capturedListeners[event] = []
          capturedListeners[event].push(handler)
        }

        readAsDataURL() {
          this.result = mockReaderResult
          capturedListeners.load?.forEach(handler => handler())
        }
      }
      vi.stubGlobal('FileReader', MockFileReader)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('should upload a local file', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should reject file with unsupported extension', () => {
      mockIsAllowedFileExtension.mockReturnValue(false)
      const file = new File(['content'], 'test.xyz', { type: 'application/xyz' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(mockSetFiles).not.toHaveBeenCalled()
    })

    it('should use empty arrays when allowed_file_types and allowed_file_extensions are undefined', () => {
      mockIsAllowedFileExtension.mockReturnValue(false)
      const file = new File(['content'], 'test.xyz', { type: 'application/xyz' })

      const configWithUndefined = {
        ...defaultFileConfig,
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      } as unknown as FileUpload

      const { result } = renderHook(() => useFile(configWithUndefined))
      result.current.handleLocalFileUpload(file)

      expect(mockIsAllowedFileExtension).toHaveBeenCalledWith('test.xyz', 'application/xyz', [], [])
    })

    it('should reject file when upload is disabled and noNeedToCheckEnable is false', () => {
      const disabledConfig = { ...defaultFileConfig, enabled: false } as FileUpload
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      const { result } = renderHook(() => useFile(disabledConfig, false))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should reject image file exceeding size limit', () => {
      mockGetSupportFileType.mockReturnValue('image')
      const largeFile = new File([new ArrayBuffer(20 * 1024 * 1024)], 'large.png', { type: 'image/png' })
      Object.defineProperty(largeFile, 'size', { value: 20 * 1024 * 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(largeFile)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should reject audio file exceeding size limit', () => {
      mockGetSupportFileType.mockReturnValue('audio')
      const largeFile = new File([], 'large.mp3', { type: 'audio/mpeg' })
      Object.defineProperty(largeFile, 'size', { value: 60 * 1024 * 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(largeFile)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should reject video file exceeding size limit', () => {
      mockGetSupportFileType.mockReturnValue('video')
      const largeFile = new File([], 'large.mp4', { type: 'video/mp4' })
      Object.defineProperty(largeFile, 'size', { value: 200 * 1024 * 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(largeFile)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should reject document file exceeding size limit', () => {
      mockGetSupportFileType.mockReturnValue('document')
      const largeFile = new File([], 'large.pdf', { type: 'application/pdf' })
      Object.defineProperty(largeFile, 'size', { value: 20 * 1024 * 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(largeFile)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should reject custom file exceeding document size limit', () => {
      mockGetSupportFileType.mockReturnValue('custom')
      const largeFile = new File([], 'large.xyz', { type: 'application/octet-stream' })
      Object.defineProperty(largeFile, 'size', { value: 20 * 1024 * 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(largeFile)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should allow custom file within document size limit', () => {
      mockGetSupportFileType.mockReturnValue('custom')
      const file = new File(['content'], 'file.xyz', { type: 'application/octet-stream' })
      Object.defineProperty(file, 'size', { value: 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should allow document file within size limit', () => {
      mockGetSupportFileType.mockReturnValue('document')
      const file = new File(['content'], 'small.pdf', { type: 'application/pdf' })
      Object.defineProperty(file, 'size', { value: 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should allow file with unknown type (default case)', () => {
      mockGetSupportFileType.mockReturnValue('unknown')
      const file = new File(['content'], 'test.bin', { type: 'application/octet-stream' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      // Should not be rejected - unknown type passes checkSizeLimit
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('should allow image file within size limit', () => {
      mockGetSupportFileType.mockReturnValue('image')
      const file = new File(['content'], 'small.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should allow audio file within size limit', () => {
      mockGetSupportFileType.mockReturnValue('audio')
      const file = new File(['content'], 'small.mp3', { type: 'audio/mpeg' })
      Object.defineProperty(file, 'size', { value: 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should allow video file within size limit', () => {
      mockGetSupportFileType.mockReturnValue('video')
      const file = new File(['content'], 'small.mp4', { type: 'video/mp4' })
      Object.defineProperty(file, 'size', { value: 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should set base64Url for image files during upload', () => {
      mockGetSupportFileType.mockReturnValue('image')
      const file = new File(['content'], 'photo.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: 1024 })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockSetFiles).toHaveBeenCalled()
      // The file should have been added with base64Url set (for image type)
      const addedFiles = mockSetFiles.mock.calls[0][0]
      expect(addedFiles[0].base64Url).toBe('data:text/plain;base64,Y29udGVudA==')
    })

    it('should set empty base64Url for non-image files during upload', () => {
      mockGetSupportFileType.mockReturnValue('document')
      const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockSetFiles).toHaveBeenCalled()
      const addedFiles = mockSetFiles.mock.calls[0][0]
      expect(addedFiles[0].base64Url).toBe('')
    })

    it('should call fileUpload with callbacks after FileReader loads', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockFileUpload).toHaveBeenCalled()
      const uploadCall = mockFileUpload.mock.calls[0][0]

      // Test progress callback
      uploadCall.onProgressCallback(50)
      expect(mockSetFiles).toHaveBeenCalled()

      // Test success callback
      uploadCall.onSuccessCallback({ id: 'uploaded-1' })
      expect(mockSetFiles).toHaveBeenCalled()
    })

    it('should handle fileUpload error callback', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      const uploadCall = mockFileUpload.mock.calls[0][0]
      uploadCall.onErrorCallback(new Error('upload failed'))

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should handle FileReader error event', () => {
      capturedListeners = {}
      const errorListeners: (() => void)[] = []

      class ErrorFileReader {
        result: string | null = null
        addEventListener(event: string, handler: () => void) {
          if (event === 'error')
            errorListeners.push(handler)
          if (!capturedListeners[event])
            capturedListeners[event] = []
          capturedListeners[event].push(handler)
        }

        readAsDataURL() {
          // Simulate error instead of load
          errorListeners.forEach(handler => handler())
        }
      }
      vi.stubGlobal('FileReader', ErrorFileReader)

      const file = new File(['content'], 'test.txt', { type: 'text/plain' })
      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
  })

  describe('handleClipboardPasteFile', () => {
    it('should handle file paste from clipboard', () => {
      const file = new File(['content'], 'pasted.png', { type: 'image/png' })
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const event = {
        clipboardData: {
          files: [file],
          getData: () => '',
        },
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>

      result.current.handleClipboardPasteFile(event)
      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('should not handle paste when text is present', () => {
      const file = new File(['content'], 'pasted.png', { type: 'image/png' })
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const event = {
        clipboardData: {
          files: [file],
          getData: () => 'some text',
        },
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>

      result.current.handleClipboardPasteFile(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe('drag and drop handlers', () => {
    it('should set isDragActive on drag enter', () => {
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent<HTMLElement>
      act(() => {
        result.current.handleDragFileEnter(event)
      })

      expect(result.current.isDragActive).toBe(true)
    })

    it('should call preventDefault on drag over', () => {
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent<HTMLElement>
      result.current.handleDragFileOver(event)

      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('should unset isDragActive on drag leave', () => {
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const enterEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent<HTMLElement>
      act(() => {
        result.current.handleDragFileEnter(enterEvent)
      })
      expect(result.current.isDragActive).toBe(true)

      const leaveEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent<HTMLElement>
      act(() => {
        result.current.handleDragFileLeave(leaveEvent)
      })
      expect(result.current.isDragActive).toBe(false)
    })

    it('should handle file drop', () => {
      const file = new File(['content'], 'dropped.txt', { type: 'text/plain' })
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [file] },
      } as unknown as React.DragEvent<HTMLElement>

      act(() => {
        result.current.handleDropFile(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
      expect(result.current.isDragActive).toBe(false)
    })

    it('should not upload when no file is dropped', () => {
      const { result } = renderHook(() => useFile(defaultFileConfig))

      const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [] },
      } as unknown as React.DragEvent<HTMLElement>

      act(() => {
        result.current.handleDropFile(event)
      })

      // No file upload should be triggered
      expect(mockSetFiles).not.toHaveBeenCalled()
    })
  })

  describe('noop handlers', () => {
    it('should have handleLoadFileFromLinkSuccess as noop', () => {
      const { result } = renderHook(() => useFile(defaultFileConfig))

      expect(() => result.current.handleLoadFileFromLinkSuccess()).not.toThrow()
    })

    it('should have handleLoadFileFromLinkError as noop', () => {
      const { result } = renderHook(() => useFile(defaultFileConfig))

      expect(() => result.current.handleLoadFileFromLinkError()).not.toThrow()
    })
  })
})
