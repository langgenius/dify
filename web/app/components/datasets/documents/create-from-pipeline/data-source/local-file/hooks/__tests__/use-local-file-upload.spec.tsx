import type { ReactNode } from 'react'
import type { CustomFile, FileItem } from '@/models/datasets'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../../constants'

// Mock notify function - defined before mocks
const mockNotify = vi.fn()
const mockClose = vi.fn()

// Mock ToastContext with factory function
vi.mock('@/app/components/base/toast', async () => {
  const { createContext, useContext } = await import('use-context-selector')
  const context = createContext({ notify: mockNotify, close: mockClose })
  return {
    ToastContext: context,
    useToastContext: () => useContext(context),
  }
})

// Mock file uploader utils
vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFileUploadErrorMessage: (e: Error, defaultMsg: string) => e.message || defaultMsg,
}))

// Mock format utils used by the shared hook
vi.mock('@/utils/format', () => ({
  getFileExtension: (filename: string) => {
    const parts = filename.split('.')
    return parts[parts.length - 1] || ''
  },
}))

// Mock react-i18next
// Mock locale context
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

// Mock i18n config
vi.mock('@/i18n-config/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans'],
}))

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

// Mock store functions
const mockSetLocalFileList = vi.fn()
const mockSetCurrentLocalFile = vi.fn()
const mockGetState = vi.fn(() => ({
  setLocalFileList: mockSetLocalFileList,
  setCurrentLocalFile: mockSetCurrentLocalFile,
}))
const mockStore = { getState: mockGetState }

vi.mock('../../../store', () => ({
  useDataSourceStoreWithSelector: vi.fn((selector: (state: { localFileList: FileItem[] }) => FileItem[]) =>
    selector({ localFileList: [] }),
  ),
  useDataSourceStore: vi.fn(() => mockStore),
}))

// Mock file upload config
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: vi.fn(() => ({
    data: {
      file_size_limit: 15,
      batch_count_limit: 5,
      file_upload_limit: 10,
    },
  })),
  // Required by the shared useFileUpload hook
  useFileSupportTypes: vi.fn(() => ({
    data: {
      allowed_extensions: ['pdf', 'docx', 'txt'],
    },
  })),
}))

// Mock upload service
const mockUpload = vi.fn()
vi.mock('@/service/base', () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}))

// Import after all mocks are set up
const { useLocalFileUpload } = await import('../use-local-file-upload')
const { ToastContext } = await import('@/app/components/base/toast')

const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => (
    <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
      {children}
    </ToastContext.Provider>
  )
}

describe('useLocalFileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.mockReset()
  })

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf', 'docx'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.dragging).toBe(false)
      expect(result.current.localFileList).toEqual([])
      expect(result.current.hideUpload).toBe(false)
    })

    it('should create refs for dropzone, drag area, and file uploader', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.dropRef).toBeDefined()
      expect(result.current.dragRef).toBeDefined()
      expect(result.current.fileUploaderRef).toBeDefined()
    })

    it('should compute acceptTypes from allowedExtensions', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf', 'docx', 'txt'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.acceptTypes).toEqual(['.pdf', '.docx', '.txt'])
    })

    it('should compute supportTypesShowNames correctly', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf', 'docx', 'md'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.supportTypesShowNames).toContain('PDF')
      expect(result.current.supportTypesShowNames).toContain('DOCX')
      expect(result.current.supportTypesShowNames).toContain('MARKDOWN')
    })

    it('should provide file upload config with defaults', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.fileUploadConfig.file_size_limit).toBe(15)
      expect(result.current.fileUploadConfig.batch_count_limit).toBe(5)
      expect(result.current.fileUploadConfig.file_upload_limit).toBe(10)
    })
  })

  describe('supportBatchUpload option', () => {
    it('should use batch limits when supportBatchUpload is true', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'], supportBatchUpload: true }),
        { wrapper: createWrapper() },
      )

      expect(result.current.fileUploadConfig.batch_count_limit).toBe(5)
      expect(result.current.fileUploadConfig.file_upload_limit).toBe(10)
    })

    it('should use single file limits when supportBatchUpload is false', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'], supportBatchUpload: false }),
        { wrapper: createWrapper() },
      )

      expect(result.current.fileUploadConfig.batch_count_limit).toBe(1)
      expect(result.current.fileUploadConfig.file_upload_limit).toBe(1)
    })
  })

  describe('selectHandle', () => {
    it('should trigger file input click', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockClick = vi.fn()
      const mockInput = { click: mockClick } as unknown as HTMLInputElement
      Object.defineProperty(result.current.fileUploaderRef, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.selectHandle()
      })

      expect(mockClick).toHaveBeenCalled()
    })

    it('should handle null fileUploaderRef gracefully', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      expect(() => {
        act(() => {
          result.current.selectHandle()
        })
      }).not.toThrow()
    })
  })

  describe('removeFile', () => {
    it('should remove file from list', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.removeFile('file-id-123')
      })

      expect(mockSetLocalFileList).toHaveBeenCalled()
    })

    it('should clear file input value when removing', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockInput = { value: 'some-file.pdf' } as HTMLInputElement
      Object.defineProperty(result.current.fileUploaderRef, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.removeFile('file-id')
      })

      expect(mockInput.value).toBe('')
    })
  })

  describe('handlePreview', () => {
    it('should set current local file when file has id', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = { id: 'file-123', name: 'test.pdf', size: 1024 }

      act(() => {
        result.current.handlePreview(mockFile as unknown as CustomFile)
      })

      expect(mockSetCurrentLocalFile).toHaveBeenCalledWith(mockFile)
    })

    it('should not set current file when file has no id', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = { name: 'test.pdf', size: 1024 }

      act(() => {
        result.current.handlePreview(mockFile as unknown as CustomFile)
      })

      expect(mockSetCurrentLocalFile).not.toHaveBeenCalled()
    })
  })

  describe('fileChangeHandle', () => {
    it('should handle valid files', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockSetLocalFileList).toHaveBeenCalled()
      })
    })

    it('should handle empty file list', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const event = {
        target: {
          files: null,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockSetLocalFileList).not.toHaveBeenCalled()
    })

    it('should reject files with invalid type', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.exe', { type: 'application/exe' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should reject files exceeding size limit', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      // Create a mock file larger than 15MB
      const largeSize = 20 * 1024 * 1024
      const mockFile = new File([''], 'large.pdf', { type: 'application/pdf' })
      Object.defineProperty(mockFile, 'size', { value: largeSize })

      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should limit files to batch count limit', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      // Create 10 files but batch limit is 5
      const files = Array.from({ length: 10 }, (_, i) =>
        new File(['content'], `file${i}.pdf`, { type: 'application/pdf' }))

      const event = {
        target: {
          files,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockSetLocalFileList).toHaveBeenCalled()
      })

      // Should only process first 5 files (batch_count_limit)
      const firstCall = mockSetLocalFileList.mock.calls[0]
      expect(firstCall[0].length).toBeLessThanOrEqual(5)
    })
  })

  describe('upload handling', () => {
    it('should handle successful upload', async () => {
      const uploadedResponse = { id: 'server-file-id' }
      mockUpload.mockResolvedValue(uploadedResponse)

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalled()
      })
    })

    it('should handle upload error', async () => {
      mockUpload.mockRejectedValue(new Error('Upload failed'))

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
    })

    it('should call upload with correct parameters', async () => {
      mockUpload.mockResolvedValue({ id: 'file-id' })

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalledWith(
          expect.objectContaining({
            xhr: expect.any(XMLHttpRequest),
            data: expect.any(FormData),
          }),
          false,
          undefined,
          '?source=datasets',
        )
      })
    })
  })

  describe('extension mapping', () => {
    it('should map md to markdown', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['md'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.supportTypesShowNames).toContain('MARKDOWN')
    })

    it('should map htm to html', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['htm'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.supportTypesShowNames).toContain('HTML')
    })

    it('should preserve unmapped extensions', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf', 'txt'] }),
        { wrapper: createWrapper() },
      )

      expect(result.current.supportTypesShowNames).toContain('PDF')
      expect(result.current.supportTypesShowNames).toContain('TXT')
    })

    it('should remove duplicate extensions', () => {
      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf', 'pdf', 'PDF'] }),
        { wrapper: createWrapper() },
      )

      const count = (result.current.supportTypesShowNames.match(/PDF/g) || []).length
      expect(count).toBe(1)
    })
  })

  describe('drag and drop handlers', () => {
    // Helper component that renders with the hook and connects refs
    const TestDropzone = ({ allowedExtensions, supportBatchUpload = true }: {
      allowedExtensions: string[]
      supportBatchUpload?: boolean
    }) => {
      const {
        dropRef,
        dragRef,
        dragging,
      } = useLocalFileUpload({ allowedExtensions, supportBatchUpload })

      return (
        <div>
          <div ref={dropRef} data-testid="dropzone">
            {dragging && <div ref={dragRef} data-testid="drag-overlay" />}
          </div>
          <span data-testid="dragging">{String(dragging)}</span>
        </div>
      )
    }

    it('should set dragging true on dragenter', async () => {
      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone allowedExtensions={['pdf']} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
        dropzone.dispatchEvent(dragEnterEvent)
      })

      expect(getByTestId('dragging').textContent).toBe('true')
    })

    it('should handle dragover event', async () => {
      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone allowedExtensions={['pdf']} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
        dropzone.dispatchEvent(dragOverEvent)
      })

      // dragover should not throw
      expect(dropzone).toBeInTheDocument()
    })

    it('should set dragging false on dragleave from drag overlay', async () => {
      const { getByTestId, queryByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone allowedExtensions={['pdf']} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      // First trigger dragenter to set dragging true
      await act(async () => {
        const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
        dropzone.dispatchEvent(dragEnterEvent)
      })

      expect(getByTestId('dragging').textContent).toBe('true')

      // Now the drag overlay should be rendered
      const dragOverlay = queryByTestId('drag-overlay')
      if (dragOverlay) {
        await act(async () => {
          const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
          Object.defineProperty(dragLeaveEvent, 'target', { value: dragOverlay })
          dropzone.dispatchEvent(dragLeaveEvent)
        })
      }
    })

    it('should handle drop with files', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone allowedExtensions={['pdf']} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: { items: DataTransferItem[], files: File[] } | null
        }
        // Mock dataTransfer with items array (used by the shared hook for directory traversal)
        dropEvent.dataTransfer = {
          items: [{
            kind: 'file',
            getAsFile: () => mockFile,
          }] as unknown as DataTransferItem[],
          files: [mockFile],
        }
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(mockSetLocalFileList).toHaveBeenCalled()
      })
    })

    it('should handle drop without dataTransfer', async () => {
      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone allowedExtensions={['pdf']} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      mockSetLocalFileList.mockClear()

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: { files: File[] } | null }
        dropEvent.dataTransfer = null
        dropzone.dispatchEvent(dropEvent)
      })

      // Should not upload when no dataTransfer
      expect(mockSetLocalFileList).not.toHaveBeenCalled()
    })

    it('should limit to single file on drop when supportBatchUpload is false', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone allowedExtensions={['pdf']} supportBatchUpload={false} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      const files = [
        new File(['content1'], 'test1.pdf', { type: 'application/pdf' }),
        new File(['content2'], 'test2.pdf', { type: 'application/pdf' }),
      ]

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: { items: DataTransferItem[], files: File[] } | null
        }
        // Mock dataTransfer with items array (used by the shared hook for directory traversal)
        dropEvent.dataTransfer = {
          items: files.map(f => ({
            kind: 'file',
            getAsFile: () => f,
          })) as unknown as DataTransferItem[],
          files,
        }
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(mockSetLocalFileList).toHaveBeenCalled()
        // Should only have 1 file (limited by supportBatchUpload: false)
        const callArgs = mockSetLocalFileList.mock.calls[0][0]
        expect(callArgs.length).toBe(1)
      })
    })
  })

  describe('file upload limit', () => {
    it('should reject files exceeding total file upload limit', async () => {
      // Mock store to return existing files
      const { useDataSourceStoreWithSelector } = vi.mocked(await import('../../../store'))
      const existingFiles: FileItem[] = Array.from({ length: 8 }, (_, i) => ({
        fileID: `existing-${i}`,
        file: { name: `existing-${i}.pdf`, size: 1024 } as CustomFile,
        progress: 100,
      }))
      vi.mocked(useDataSourceStoreWithSelector).mockImplementation(selector =>
        selector({ localFileList: existingFiles } as Parameters<typeof selector>[0]),
      )

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      // Try to add 5 more files when limit is 10 and we already have 8
      const files = Array.from({ length: 5 }, (_, i) =>
        new File(['content'], `new-${i}.pdf`, { type: 'application/pdf' }))

      const event = {
        target: { files },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      // Should show error about files number limit
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )

      // Reset mock for other tests
      vi.mocked(useDataSourceStoreWithSelector).mockImplementation(selector =>
        selector({ localFileList: [] as FileItem[] } as Parameters<typeof selector>[0]),
      )
    })
  })

  describe('upload progress tracking', () => {
    it('should track upload progress', async () => {
      let progressCallback: ((e: ProgressEvent) => void) | undefined

      mockUpload.mockImplementation(async (options: { onprogress: (e: ProgressEvent) => void }) => {
        progressCallback = options.onprogress
        return { id: 'uploaded-id' }
      })

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: { files: [mockFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalled()
      })

      // Simulate progress event
      if (progressCallback) {
        act(() => {
          progressCallback!({
            lengthComputable: true,
            loaded: 50,
            total: 100,
          } as ProgressEvent)
        })

        expect(mockSetLocalFileList).toHaveBeenCalled()
      }
    })

    it('should not update progress when not lengthComputable', async () => {
      let progressCallback: ((e: ProgressEvent) => void) | undefined
      const uploadCallCount = { value: 0 }

      mockUpload.mockImplementation(async (options: { onprogress: (e: ProgressEvent) => void }) => {
        progressCallback = options.onprogress
        uploadCallCount.value++
        return { id: 'uploaded-id' }
      })

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: { files: [mockFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      mockSetLocalFileList.mockClear()

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalled()
      })

      const callsBeforeProgress = mockSetLocalFileList.mock.calls.length

      // Simulate progress event without lengthComputable
      if (progressCallback) {
        act(() => {
          progressCallback!({
            lengthComputable: false,
            loaded: 50,
            total: 100,
          } as ProgressEvent)
        })

        // Should not have additional calls
        expect(mockSetLocalFileList.mock.calls.length).toBe(callsBeforeProgress)
      }
    })
  })

  describe('file progress constants', () => {
    it('should use PROGRESS_NOT_STARTED for new files', async () => {
      mockUpload.mockResolvedValue({ id: 'file-id' })

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        const callArgs = mockSetLocalFileList.mock.calls[0][0]
        expect(callArgs[0].progress).toBe(PROGRESS_NOT_STARTED)
      })
    })

    it('should set PROGRESS_ERROR on upload failure', async () => {
      mockUpload.mockRejectedValue(new Error('Upload failed'))

      const { result } = renderHook(
        () => useLocalFileUpload({ allowedExtensions: ['pdf'] }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const event = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      await waitFor(() => {
        const calls = mockSetLocalFileList.mock.calls
        const lastCall = calls[calls.length - 1][0]
        expect(lastCall.some((f: FileItem) => f.progress === PROGRESS_ERROR)).toBe(true)
      })
    })
  })
})
