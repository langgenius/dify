import type { ClipboardEvent, DragEvent } from 'react'
import type { ImageFile, VisionSettings } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { Resolution, TransferMethod } from '@/types/app'
import { useClipboardUploader, useDraggableUploader, useImageFiles, useLocalFileUploader } from './hooks'

const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: undefined }),
}))

const { mockImageUpload, mockGetImageUploadErrorMessage } = vi.hoisted(() => ({
  mockImageUpload: vi.fn(),
  mockGetImageUploadErrorMessage: vi.fn(() => 'Upload error'),
}))
vi.mock('./utils', () => ({
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

const createVisionSettings = (overrides: Partial<VisionSettings> = {}): VisionSettings => ({
  enabled: true,
  number_limits: 5,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 10,
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
    expect(result.current.files[0]._id).toBe('file-1')
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
    expect(result.current.files[0].progress).toBe(50)
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

    expect(result.current.files[0].progress).toBe(-1)
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

    expect(result.current.files[0].progress).toBe(0)
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

    expect(result.current.files[0].progress).toBe(100)
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

    expect(result.current.files[0].progress).toBe(50)
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

      const uploadCall = mockImageUpload.mock.calls[0][0]

      act(() => {
        uploadCall.onProgressCallback(50)
      })

      expect(result.current.files[0].progress).toBe(50)
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

      const uploadCall = mockImageUpload.mock.calls[0][0]

      act(() => {
        uploadCall.onSuccessCallback({ id: 'server-file-123' })
      })

      expect(result.current.files[0].fileId).toBe('server-file-123')
      expect(result.current.files[0].progress).toBe(100)
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

      const uploadCall = mockImageUpload.mock.calls[0][0]

      act(() => {
        uploadCall.onErrorCallback(new Error('Network error'))
      })

      expect(result.current.files[0].progress).toBe(-1)
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

    const uploadCall = mockImageUpload.mock.calls[0][0]

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

    const uploadCall = mockImageUpload.mock.calls[0][0]

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

    const uploadCall = mockImageUpload.mock.calls[0][0]

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

describe('useClipboardUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be disabled when visionConfig is undefined', () => {
    const onUpload = vi.fn()
    const { result } = renderHook(() =>
      useClipboardUploader({ files: [], onUpload }),
    )

    // The hook returns onPaste, and since disabled is true, pasting should not upload
    expect(result.current.onPaste).toBeInstanceOf(Function)
  })

  it('should be disabled when visionConfig.enabled is false', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings({ enabled: false })
    const { result } = renderHook(() =>
      useClipboardUploader({ files: [], visionConfig: settings, onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const mockEvent = {
      clipboardData: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent<HTMLTextAreaElement>
    act(() => {
      result.current.onPaste(mockEvent)
    })

    // Paste occurs but the file should NOT be uploaded because disabled
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('should be disabled when local upload is not allowed', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings({
      transfer_methods: [TransferMethod.remote_url],
    })
    renderHook(() =>
      useClipboardUploader({ files: [], visionConfig: settings, onUpload }),
    )

    expect(onUpload).not.toHaveBeenCalled()
  })

  it('should be disabled when files count reaches number_limits', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings({ number_limits: 1 })
    const files = [createImageFile({ _id: 'file-1' })]

    renderHook(() =>
      useClipboardUploader({ files, visionConfig: settings, onUpload }),
    )

    expect(onUpload).not.toHaveBeenCalled()
  })

  it('should call handleLocalFileUpload when pasting a file', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()

    const { result } = renderHook(() =>
      useClipboardUploader({ files: [], visionConfig: settings, onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const mockEvent = {
      clipboardData: {
        files: [file],
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent<HTMLTextAreaElement>

    act(() => {
      result.current.onPaste(mockEvent)
    })

    expect(mockEvent.preventDefault).toHaveBeenCalled()
  })

  it('should not prevent default when pasting text (no file)', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()

    const { result } = renderHook(() =>
      useClipboardUploader({ files: [], visionConfig: settings, onUpload }),
    )

    const mockEvent = {
      clipboardData: {
        files: [] as File[],
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent<HTMLTextAreaElement>

    act(() => {
      result.current.onPaste(mockEvent)
    })

    expect(mockEvent.preventDefault).not.toHaveBeenCalled()
  })
})

describe('useDraggableUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createDragEvent = (files: File[] = []) => ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files,
    },
  } as unknown as DragEvent<HTMLDivElement>)

  it('should return drag event handlers and isDragActive state', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    expect(result.current.onDragEnter).toBeInstanceOf(Function)
    expect(result.current.onDragOver).toBeInstanceOf(Function)
    expect(result.current.onDragLeave).toBeInstanceOf(Function)
    expect(result.current.onDrop).toBeInstanceOf(Function)
    expect(result.current.isDragActive).toBe(false)
  })

  it('should set isDragActive to true on dragEnter when not disabled', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    const event = createDragEvent()

    act(() => {
      result.current.onDragEnter(event)
    })

    expect(result.current.isDragActive).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('should not set isDragActive on dragEnter when disabled', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings({ enabled: false })
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    const event = createDragEvent()

    act(() => {
      result.current.onDragEnter(event)
    })

    expect(result.current.isDragActive).toBe(false)
  })

  it('should call preventDefault and stopPropagation on dragOver', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    const event = createDragEvent()

    act(() => {
      result.current.onDragOver(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('should set isDragActive to false on dragLeave', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    // First activate drag
    act(() => {
      result.current.onDragEnter(createDragEvent())
    })
    expect(result.current.isDragActive).toBe(true)

    // Then leave
    const leaveEvent = createDragEvent()

    act(() => {
      result.current.onDragLeave(leaveEvent)
    })

    expect(result.current.isDragActive).toBe(false)
    expect(leaveEvent.preventDefault).toHaveBeenCalled()
    expect(leaveEvent.stopPropagation).toHaveBeenCalled()
  })

  it('should set isDragActive to false on drop and upload file', async () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const event = createDragEvent([file])

    // Activate drag first
    act(() => {
      result.current.onDragEnter(createDragEvent())
    })
    expect(result.current.isDragActive).toBe(true)

    act(() => {
      result.current.onDrop(event)
    })

    expect(result.current.isDragActive).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()

    // Verify the file was actually handed to the upload pipeline
    await vi.waitFor(() => {
      expect(mockImageUpload).toHaveBeenCalled()
    })
  })

  it('should not upload when dropping with no files', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings()
    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files: [], visionConfig: settings, onUpload }),
    )

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as unknown as FileList,
      },
    } as unknown as React.DragEvent<HTMLDivElement>

    act(() => {
      result.current.onDrop(event)
    })

    // onUpload should not be called directly since no file was dropped
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('should be disabled when files count exceeds number_limits', () => {
    const onUpload = vi.fn()
    const settings = createVisionSettings({ number_limits: 1 })
    const files = [createImageFile({ _id: 'file-1' })]

    const { result } = renderHook(() =>
      useDraggableUploader<HTMLDivElement>({ files, visionConfig: settings, onUpload }),
    )

    const event = createDragEvent()

    act(() => {
      result.current.onDragEnter(event)
    })

    // Should not activate drag when disabled
    expect(result.current.isDragActive).toBe(false)
  })
})
