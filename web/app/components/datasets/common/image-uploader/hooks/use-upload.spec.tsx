import type { PropsWithChildren } from 'react'
import type { FileEntity } from '../types'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { FileContextProvider } from '../store'
import { useUpload } from './use-upload'

// Mock dependencies
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: vi.fn(() => ({
    data: {
      image_file_batch_limit: 10,
      single_chunk_attachment_limit: 20,
      attachment_image_file_size_limit: 15,
    },
  })),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

type FileUploadOptions = {
  file: File
  onProgressCallback?: (progress: number) => void
  onSuccessCallback?: (res: { id: string, extension: string, mime_type: string, size: number }) => void
  onErrorCallback?: (error?: Error) => void
}

const mockFileUpload = vi.fn<(options: FileUploadOptions) => void>()
const mockGetFileUploadErrorMessage = vi.fn(() => 'Upload error')

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  fileUpload: (options: FileUploadOptions) => mockFileUpload(options),
  getFileUploadErrorMessage: () => mockGetFileUploadErrorMessage(),
}))

const createWrapper = () => {
  return ({ children }: PropsWithChildren) => (
    <FileContextProvider>
      {children}
    </FileContextProvider>
  )
}

const createMockFile = (name = 'test.png', _size = 1024, type = 'image/png') => {
  return new File(['test content'], name, { type })
}

// Mock FileReader
type EventCallback = () => void

class MockFileReader {
  result: string | ArrayBuffer | null = null
  onload: EventCallback | null = null
  onerror: EventCallback | null = null
  private listeners: Record<string, EventCallback[]> = {}

  addEventListener(event: string, callback: EventCallback) {
    if (!this.listeners[event])
      this.listeners[event] = []
    this.listeners[event].push(callback)
  }

  removeEventListener(event: string, callback: EventCallback) {
    if (this.listeners[event])
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
  }

  readAsDataURL(_file: File) {
    setTimeout(() => {
      this.result = 'data:image/png;base64,mockBase64Data'
      this.listeners.load?.forEach(cb => cb())
    }, 0)
  }

  triggerError() {
    this.listeners.error?.forEach(cb => cb())
  }
}

describe('useUpload hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFileUpload.mockImplementation(({ onSuccessCallback }) => {
      setTimeout(() => {
        onSuccessCallback?.({ id: 'uploaded-id', extension: 'png', mime_type: 'image/png', size: 1024 })
      }, 0)
    })
    // Mock FileReader globally
    vi.stubGlobal('FileReader', MockFileReader)
  })

  describe('Initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(result.current.dragging).toBe(false)
      expect(result.current.uploaderRef).toBeDefined()
      expect(result.current.dragRef).toBeDefined()
      expect(result.current.dropRef).toBeDefined()
    })

    it('should return file upload config', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(result.current.fileUploadConfig).toBeDefined()
      expect(result.current.fileUploadConfig.imageFileBatchLimit).toBe(10)
      expect(result.current.fileUploadConfig.singleChunkAttachmentLimit).toBe(20)
      expect(result.current.fileUploadConfig.imageFileSizeLimit).toBe(15)
    })
  })

  describe('File Operations', () => {
    it('should expose selectHandle function', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.selectHandle).toBe('function')
    })

    it('should expose fileChangeHandle function', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.fileChangeHandle).toBe('function')
    })

    it('should expose handleRemoveFile function', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.handleRemoveFile).toBe('function')
    })

    it('should expose handleReUploadFile function', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.handleReUploadFile).toBe('function')
    })

    it('should expose handleLocalFileUpload function', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.handleLocalFileUpload).toBe('function')
    })
  })

  describe('File Validation', () => {
    it('should show error toast for invalid file type', async () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      const mockEvent = {
        target: {
          files: [createMockFile('test.exe', 1024, 'application/x-msdownload')],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(mockEvent)
      })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })

    it('should not reject valid image file types', async () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      const mockFile = createMockFile('test.png', 1024, 'image/png')

      const mockEvent = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      // File type validation should pass for png files
      // The actual upload will fail without proper FileReader mock,
      // but we're testing that type validation doesn't reject valid files
      act(() => {
        result.current.fileChangeHandle(mockEvent)
      })

      // Should not show type error for valid image type
      type ToastCall = [{ type: string, message: string }]
      const mockNotify = vi.mocked(Toast.notify)
      const calls = mockNotify.mock.calls as ToastCall[]
      const typeErrorCalls = calls.filter(
        (call: ToastCall) => call[0].type === 'error' && call[0].message.includes('Extension'),
      )
      expect(typeErrorCalls.length).toBe(0)
    })
  })

  describe('Drag and Drop Refs', () => {
    it('should provide dragRef', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(result.current.dragRef).toBeDefined()
      expect(result.current.dragRef.current).toBeNull()
    })

    it('should provide dropRef', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(result.current.dropRef).toBeDefined()
      expect(result.current.dropRef.current).toBeNull()
    })

    it('should provide uploaderRef', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(result.current.uploaderRef).toBeDefined()
      expect(result.current.uploaderRef.current).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty file list', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      const mockEvent = {
        target: {
          files: [],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(mockEvent)
      })

      // Should not throw and not show error
      expect(Toast.notify).not.toHaveBeenCalled()
    })

    it('should handle null files', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      const mockEvent = {
        target: {
          files: null,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(mockEvent)
      })

      // Should not throw
      expect(true).toBe(true)
    })

    it('should respect batch limit from config', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      // Config should have batch limit of 10
      expect(result.current.fileUploadConfig.imageFileBatchLimit).toBe(10)
    })
  })

  describe('File Size Validation', () => {
    it('should show error for files exceeding size limit', async () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      // Create a file larger than 15MB limit (15 * 1024 * 1024 bytes)
      const largeFile = new File(['x'.repeat(16 * 1024 * 1024)], 'large.png', { type: 'image/png' })
      Object.defineProperty(largeFile, 'size', { value: 16 * 1024 * 1024 })

      const mockEvent = {
        target: {
          files: [largeFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(mockEvent)
      })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })
  })

  describe('handleRemoveFile', () => {
    it('should remove file from store', async () => {
      const onChange = vi.fn()
      const initialFiles: Partial<FileEntity>[] = [
        { id: 'file1', name: 'test1.png', progress: 100 },
        { id: 'file2', name: 'test2.png', progress: 100 },
      ]

      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider value={initialFiles as FileEntity[]} onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      act(() => {
        result.current.handleRemoveFile('file1')
      })

      expect(onChange).toHaveBeenCalledWith([
        { id: 'file2', name: 'test2.png', progress: 100 },
      ])
    })
  })

  describe('handleReUploadFile', () => {
    it('should re-upload file when called with valid fileId', async () => {
      const onChange = vi.fn()
      const initialFiles: Partial<FileEntity>[] = [
        { id: 'file1', name: 'test1.png', progress: -1, originalFile: new File(['test'], 'test1.png') },
      ]

      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider value={initialFiles as FileEntity[]} onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      act(() => {
        result.current.handleReUploadFile('file1')
      })

      await waitFor(() => {
        expect(mockFileUpload).toHaveBeenCalled()
      })
    })

    it('should not re-upload when fileId is not found', () => {
      const onChange = vi.fn()
      const initialFiles: Partial<FileEntity>[] = [
        { id: 'file1', name: 'test1.png', progress: -1, originalFile: new File(['test'], 'test1.png') },
      ]

      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider value={initialFiles as FileEntity[]} onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      act(() => {
        result.current.handleReUploadFile('nonexistent')
      })

      // fileUpload should not be called for nonexistent file
      expect(mockFileUpload).not.toHaveBeenCalled()
    })

    it('should handle upload error during re-upload', async () => {
      mockFileUpload.mockImplementation(({ onErrorCallback }: FileUploadOptions) => {
        setTimeout(() => {
          onErrorCallback?.(new Error('Upload failed'))
        }, 0)
      })

      const onChange = vi.fn()
      const initialFiles: Partial<FileEntity>[] = [
        { id: 'file1', name: 'test1.png', progress: -1, originalFile: new File(['test'], 'test1.png') },
      ]

      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider value={initialFiles as FileEntity[]} onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      act(() => {
        result.current.handleReUploadFile('file1')
      })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Upload error',
        })
      })
    })
  })

  describe('handleLocalFileUpload', () => {
    it('should upload file and update progress', async () => {
      mockFileUpload.mockImplementation(({ onProgressCallback, onSuccessCallback }: FileUploadOptions) => {
        setTimeout(() => {
          onProgressCallback?.(50)
          setTimeout(() => {
            onSuccessCallback?.({ id: 'uploaded-id', extension: 'png', mime_type: 'image/png', size: 1024 })
          }, 10)
        }, 0)
      })

      const onChange = vi.fn()
      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      const mockFile = createMockFile('test.png', 1024, 'image/png')

      await act(async () => {
        result.current.handleLocalFileUpload(mockFile)
      })

      await waitFor(() => {
        expect(mockFileUpload).toHaveBeenCalled()
      })
    })

    it('should handle upload error', async () => {
      mockFileUpload.mockImplementation(({ onErrorCallback }: FileUploadOptions) => {
        setTimeout(() => {
          onErrorCallback?.(new Error('Upload failed'))
        }, 0)
      })

      const onChange = vi.fn()
      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      const mockFile = createMockFile('test.png', 1024, 'image/png')

      await act(async () => {
        result.current.handleLocalFileUpload(mockFile)
      })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Upload error',
        })
      })
    })
  })

  describe('Attachment Limit', () => {
    it('should show error when exceeding single chunk attachment limit', async () => {
      const onChange = vi.fn()
      // Pre-populate with 19 files (limit is 20)
      const initialFiles: Partial<FileEntity>[] = Array.from({ length: 19 }, (_, i) => ({
        id: `file${i}`,
        name: `test${i}.png`,
        progress: 100,
      }))

      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider value={initialFiles as FileEntity[]} onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      // Try to add 2 more files (would exceed limit of 20)
      const mockEvent = {
        target: {
          files: [
            createMockFile('new1.png'),
            createMockFile('new2.png'),
          ],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(mockEvent)
      })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })
  })

  describe('selectHandle', () => {
    it('should trigger click on uploader input when called', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      // Create a mock input element
      const mockInput = document.createElement('input')
      const clickSpy = vi.spyOn(mockInput, 'click')

      // Manually set the ref
      Object.defineProperty(result.current.uploaderRef, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.selectHandle()
      })

      expect(clickSpy).toHaveBeenCalled()
    })

    it('should not throw when uploaderRef is null', () => {
      const { result } = renderHook(() => useUpload(), {
        wrapper: createWrapper(),
      })

      expect(() => {
        act(() => {
          result.current.selectHandle()
        })
      }).not.toThrow()
    })
  })

  describe('FileReader Error Handling', () => {
    it('should show error toast when FileReader encounters an error', async () => {
      // Create a custom MockFileReader that triggers error
      class ErrorFileReader {
        result: string | ArrayBuffer | null = null
        private listeners: Record<string, EventCallback[]> = {}

        addEventListener(event: string, callback: EventCallback) {
          if (!this.listeners[event])
            this.listeners[event] = []
          this.listeners[event].push(callback)
        }

        removeEventListener(event: string, callback: EventCallback) {
          if (this.listeners[event])
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
        }

        readAsDataURL(_file: File) {
          // Trigger error instead of load
          setTimeout(() => {
            this.listeners.error?.forEach(cb => cb())
          }, 0)
        }
      }

      vi.stubGlobal('FileReader', ErrorFileReader)

      const onChange = vi.fn()
      const wrapper = ({ children }: PropsWithChildren) => (
        <FileContextProvider onChange={onChange}>
          {children}
        </FileContextProvider>
      )

      const { result } = renderHook(() => useUpload(), { wrapper })

      const mockFile = createMockFile('test.png', 1024, 'image/png')

      await act(async () => {
        result.current.handleLocalFileUpload(mockFile)
      })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })

      // Restore original MockFileReader
      vi.stubGlobal('FileReader', MockFileReader)
    })
  })

  describe('Drag and Drop Functionality', () => {
    // Test component that renders the hook with actual DOM elements
    const TestComponent = ({ onStateChange }: { onStateChange?: (dragging: boolean) => void }) => {
      const { dragging, dragRef, dropRef } = useUpload()

      // Report dragging state changes to parent
      React.useEffect(() => {
        onStateChange?.(dragging)
      }, [dragging, onStateChange])

      return (
        <div ref={dropRef} data-testid="drop-zone">
          <div ref={dragRef} data-testid="drag-boundary">
            <span data-testid="dragging-state">{dragging ? 'dragging' : 'not-dragging'}</span>
          </div>
        </div>
      )
    }

    it('should set dragging to true on dragEnter when target is not dragRef', async () => {
      const onStateChange = vi.fn()
      render(
        <FileContextProvider>
          <TestComponent onStateChange={onStateChange} />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')

      // Fire dragenter event on dropZone (not dragRef)
      await act(async () => {
        fireEvent.dragEnter(dropZone, {
          dataTransfer: { items: [] },
        })
      })

      // Verify dragging state changed to true
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')
    })

    it('should set dragging to false on dragLeave when target matches dragRef', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')
      const dragBoundary = screen.getByTestId('drag-boundary')

      // First trigger dragenter to set dragging to true
      await act(async () => {
        fireEvent.dragEnter(dropZone, {
          dataTransfer: { items: [] },
        })
      })

      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')

      // Then trigger dragleave on dragBoundary to set dragging to false
      await act(async () => {
        fireEvent.dragLeave(dragBoundary, {
          dataTransfer: { items: [] },
        })
      })

      expect(screen.getByTestId('dragging-state')).toHaveTextContent('not-dragging')
    })

    it('should handle drop event with files and reset dragging state', async () => {
      const onChange = vi.fn()

      render(
        <FileContextProvider onChange={onChange}>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')
      const mockFile = new File(['test content'], 'test.png', { type: 'image/png' })

      // First trigger dragenter
      await act(async () => {
        fireEvent.dragEnter(dropZone, {
          dataTransfer: { items: [] },
        })
      })

      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')

      // Then trigger drop with files
      await act(async () => {
        fireEvent.drop(dropZone, {
          dataTransfer: {
            items: [{
              webkitGetAsEntry: () => null,
              getAsFile: () => mockFile,
            }],
          },
        })
      })

      // Dragging should be reset to false after drop
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('not-dragging')
    })

    it('should return early when dataTransfer is null on drop', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')

      // Fire dragenter first
      await act(async () => {
        fireEvent.dragEnter(dropZone)
      })

      // Fire drop without dataTransfer
      await act(async () => {
        fireEvent.drop(dropZone)
      })

      // Should still reset dragging state
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('not-dragging')
    })

    it('should not trigger file upload for invalid file types on drop', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')
      const invalidFile = new File(['test'], 'test.exe', { type: 'application/x-msdownload' })

      await act(async () => {
        fireEvent.drop(dropZone, {
          dataTransfer: {
            items: [{
              webkitGetAsEntry: () => null,
              getAsFile: () => invalidFile,
            }],
          },
        })
      })

      // Should show error toast for invalid file type
      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })

    it('should handle drop with webkitGetAsEntry for file entries', async () => {
      const onChange = vi.fn()
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      render(
        <FileContextProvider onChange={onChange}>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')

      // Create a mock file entry that simulates webkitGetAsEntry behavior
      const mockFileEntry = {
        isFile: true,
        isDirectory: false,
        file: (callback: (file: File) => void) => callback(mockFile),
      }

      await act(async () => {
        fireEvent.drop(dropZone, {
          dataTransfer: {
            items: [{
              webkitGetAsEntry: () => mockFileEntry,
              getAsFile: () => mockFile,
            }],
          },
        })
      })

      // Dragging should be reset
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('not-dragging')
    })
  })

  describe('Drag Events', () => {
    const TestComponent = () => {
      const { dragging, dragRef, dropRef } = useUpload()
      return (
        <div ref={dropRef} data-testid="drop-zone">
          <div ref={dragRef} data-testid="drag-boundary">
            <span data-testid="dragging-state">{dragging ? 'dragging' : 'not-dragging'}</span>
          </div>
        </div>
      )
    }

    it('should handle dragEnter event and update dragging state', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')

      // Initially not dragging
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('not-dragging')

      // Fire dragEnter
      await act(async () => {
        fireEvent.dragEnter(dropZone, {
          dataTransfer: { items: [] },
        })
      })

      // Should be dragging now
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')
    })

    it('should handle dragOver event without changing state', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')

      // First trigger dragenter to set dragging
      await act(async () => {
        fireEvent.dragEnter(dropZone)
      })

      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')

      // dragOver should not change the dragging state
      await act(async () => {
        fireEvent.dragOver(dropZone)
      })

      // Should still be dragging
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')
    })

    it('should not set dragging to true when dragEnter target is dragRef', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dragBoundary = screen.getByTestId('drag-boundary')

      // Fire dragEnter directly on dragRef
      await act(async () => {
        fireEvent.dragEnter(dragBoundary)
      })

      // Should not be dragging when target is dragRef itself
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('not-dragging')
    })

    it('should not set dragging to false when dragLeave target is not dragRef', async () => {
      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      const dropZone = screen.getByTestId('drop-zone')

      // First trigger dragenter on dropZone to set dragging
      await act(async () => {
        fireEvent.dragEnter(dropZone)
      })

      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')

      // dragLeave on dropZone (not dragRef) should not change dragging state
      await act(async () => {
        fireEvent.dragLeave(dropZone)
      })

      // Should still be dragging (only dragLeave on dragRef resets)
      expect(screen.getByTestId('dragging-state')).toHaveTextContent('dragging')
    })
  })
})
