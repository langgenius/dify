import type { ImageFile } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { useImageFiles, useLocalFileUploader } from '../hooks'

const mockNotify = vi.fn()
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: undefined }),
}))

const { mockImageUpload, mockGetImageUploadErrorMessage } = vi.hoisted(() => ({
  mockImageUpload: vi.fn(),
  mockGetImageUploadErrorMessage: vi.fn(() => 'Upload error'),
}))
vi.mock('../utils', () => ({
  imageUpload: mockImageUpload,
  getImageUploadErrorMessage: mockGetImageUploadErrorMessage,
}))

let fileCounter = 0

const createImageFile = (overrides: Partial<ImageFile> = {}): ImageFile => ({
  type: TransferMethod.local_file,
  _id: `file-${fileCounter++}`,
  fileId: '',
  progress: 0,
  url: 'data:image/png;base64,abc',
  ...overrides,
})

describe('useImageFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileCounter = 0
  })

  it('should return empty files initially', () => {
    const { result } = renderHook(() => useImageFiles())
    expect(result.current.files).toEqual([])
  })

  it('should add a new file via onUpload', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1' })

    act(() => {
      result.current.onUpload(imageFile)
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0]!._id).toBe('file-1')
  })

  it('should update an existing file via onUpload when _id matches', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1', progress: 0 })

    act(() => {
      result.current.onUpload(imageFile)
    })

    act(() => {
      result.current.onUpload({ ...imageFile, progress: 50 })
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0]!.progress).toBe(50)
  })

  it('should mark a file as deleted via onRemove', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1' })

    act(() => {
      result.current.onUpload(imageFile)
    })
    expect(result.current.files).toHaveLength(1)

    act(() => {
      result.current.onRemove('file-1')
    })

    // filteredFiles excludes deleted files
    expect(result.current.files).toHaveLength(0)
  })

  it('should not modify files when onRemove is called with non-existent id', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1' })

    act(() => {
      result.current.onUpload(imageFile)
    })

    act(() => {
      result.current.onRemove('non-existent')
    })

    expect(result.current.files).toHaveLength(1)
  })

  it('should set progress to -1 via onImageLinkLoadError', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1', progress: 0 })

    act(() => {
      result.current.onUpload(imageFile)
    })

    act(() => {
      result.current.onImageLinkLoadError('file-1')
    })

    expect(result.current.files[0]!.progress).toBe(-1)
  })

  it('should not modify files when onImageLinkLoadError is called with non-existent id', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1', progress: 0 })

    act(() => {
      result.current.onUpload(imageFile)
    })

    act(() => {
      result.current.onImageLinkLoadError('non-existent')
    })

    expect(result.current.files[0]!.progress).toBe(0)
  })

  it('should set progress to 100 via onImageLinkLoadSuccess', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1', progress: 0 })

    act(() => {
      result.current.onUpload(imageFile)
    })

    act(() => {
      result.current.onImageLinkLoadSuccess('file-1')
    })

    expect(result.current.files[0]!.progress).toBe(100)
  })

  it('should not modify files when onImageLinkLoadSuccess is called with non-existent id', () => {
    const { result } = renderHook(() => useImageFiles())
    const imageFile = createImageFile({ _id: 'file-1', progress: 50 })

    act(() => {
      result.current.onUpload(imageFile)
    })

    act(() => {
      result.current.onImageLinkLoadSuccess('non-existent')
    })

    expect(result.current.files[0]!.progress).toBe(50)
  })

  it('should clear all files via onClear', () => {
    const { result } = renderHook(() => useImageFiles())

    act(() => {
      result.current.onUpload(createImageFile({ _id: 'file-1' }))
      result.current.onUpload(createImageFile({ _id: 'file-2' }))
    })

    expect(result.current.files).toHaveLength(2)

    act(() => {
      result.current.onClear()
    })

    expect(result.current.files).toHaveLength(0)
  })

  describe('onReUpload', () => {
    it('should call imageUpload when re-uploading an existing file', () => {
      const { result } = renderHook(() => useImageFiles())
      const file = new File(['test'], 'test.png', { type: 'image/png' })
      const imageFile = createImageFile({ _id: 'file-1', file, progress: -1 })

      act(() => {
        result.current.onUpload(imageFile)
      })

      act(() => {
        result.current.onReUpload('file-1')
      })

      expect(mockImageUpload).toHaveBeenCalledTimes(1)
      expect(mockImageUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          onProgressCallback: expect.any(Function),
          onSuccessCallback: expect.any(Function),
          onErrorCallback: expect.any(Function),
        }),
        false,
      )
    })

    it('should not call imageUpload when file id does not exist', () => {
      const { result } = renderHook(() => useImageFiles())

      act(() => {
        result.current.onReUpload('non-existent')
      })

      expect(mockImageUpload).not.toHaveBeenCalled()
    })

    it('should update progress via onProgressCallback during re-upload', () => {
      const { result } = renderHook(() => useImageFiles())
      const file = new File(['test'], 'test.png', { type: 'image/png' })
      const imageFile = createImageFile({ _id: 'file-1', file, progress: -1 })

      act(() => {
        result.current.onUpload(imageFile)
      })

      act(() => {
        result.current.onReUpload('file-1')
      })

      const uploadCall = mockImageUpload.mock.calls[0]![0]

      act(() => {
        uploadCall.onProgressCallback(50)
      })

      expect(result.current.files[0]!.progress).toBe(50)
    })

    it('should update fileId and progress on success callback during re-upload', () => {
      const { result } = renderHook(() => useImageFiles())
      const file = new File(['test'], 'test.png', { type: 'image/png' })
      const imageFile = createImageFile({ _id: 'file-1', file, progress: -1 })

      act(() => {
        result.current.onUpload(imageFile)
      })

      act(() => {
        result.current.onReUpload('file-1')
      })

      const uploadCall = mockImageUpload.mock.calls[0]![0]

      act(() => {
        uploadCall.onSuccessCallback({ id: 'server-file-123' })
      })

      expect(result.current.files[0]!.fileId).toBe('server-file-123')
      expect(result.current.files[0]!.progress).toBe(100)
    })

    it('should set progress to -1 and notify on error callback during re-upload', () => {
      const { result } = renderHook(() => useImageFiles())
      const file = new File(['test'], 'test.png', { type: 'image/png' })
      const imageFile = createImageFile({ _id: 'file-1', file, progress: -1 })

      act(() => {
        result.current.onUpload(imageFile)
      })

      act(() => {
        result.current.onReUpload('file-1')
      })

      const uploadCall = mockImageUpload.mock.calls[0]![0]

      act(() => {
        uploadCall.onErrorCallback(new Error('Network error'))
      })

      expect(result.current.files[0]!.progress).toBe(-1)
      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'Upload error' })
    })
  })

  it('should filter out deleted files in returned files', () => {
    const { result } = renderHook(() => useImageFiles())

    act(() => {
      result.current.onUpload(createImageFile({ _id: 'file-1' }))
      result.current.onUpload(createImageFile({ _id: 'file-2' }))
      result.current.onUpload(createImageFile({ _id: 'file-3' }))
    })

    act(() => {
      result.current.onRemove('file-2')
    })

    expect(result.current.files).toHaveLength(2)
    expect(result.current.files.map(f => f._id)).toEqual(['file-1', 'file-3'])
  })
})

describe('useLocalFileUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return disabled status and handleLocalFileUpload function', () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload, limit: 10 }),
    )

    expect(result.current.disabled).toBe(false)
    expect(result.current.handleLocalFileUpload).toBeInstanceOf(Function)
  })

  it('should not upload when disabled', () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload, disabled: true }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    expect(onUpload).not.toHaveBeenCalled()
  })

  it('should reject files with disallowed extensions', () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload }),
    )

    const file = new File(['test'], 'test.svg', { type: 'image/svg+xml' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    expect(onUpload).not.toHaveBeenCalled()
  })

  it('should reject files exceeding size limit', () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload, limit: 1 }), // 1MB limit
    )

    // Create a file larger than 1MB
    const largeContent = new Uint8Array(2 * 1024 * 1024)
    const file = new File([largeContent], 'test.png', { type: 'image/png' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    expect(onUpload).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should read file and call onUpload on successful FileReader load', async () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    // Wait for FileReader to complete
    await vi.waitFor(() => {
      expect(onUpload).toHaveBeenCalled()
    })

    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransferMethod.local_file,
        file,
        progress: 0,
      }),
    )

    // imageUpload should be called after FileReader load
    expect(mockImageUpload).toHaveBeenCalledTimes(1)
  })

  it('should call onUpload with progress during imageUpload', async () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    await vi.waitFor(() => {
      expect(mockImageUpload).toHaveBeenCalled()
    })

    const uploadCall = mockImageUpload.mock.calls[0]![0]

    act(() => {
      uploadCall.onProgressCallback(75)
    })

    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 75 }),
    )
  })

  it('should call onUpload with fileId and progress 100 on upload success', async () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    await vi.waitFor(() => {
      expect(mockImageUpload).toHaveBeenCalled()
    })

    const uploadCall = mockImageUpload.mock.calls[0]![0]

    act(() => {
      uploadCall.onSuccessCallback({ id: 'uploaded-id' })
    })

    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'uploaded-id', progress: 100 }),
    )
  })

  it('should notify error and call onUpload with progress -1 on upload failure', async () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useLocalFileUploader({ onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })

    act(() => {
      result.current.handleLocalFileUpload(file)
    })

    await vi.waitFor(() => {
      expect(mockImageUpload).toHaveBeenCalled()
    })

    const uploadCall = mockImageUpload.mock.calls[0]![0]

    act(() => {
      uploadCall.onErrorCallback(new Error('fail'))
    })

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ progress: -1 }),
    )
  })
})
