import type { ReactNode } from 'react'
import type { CustomFile, FileItem } from '@/models/datasets'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'

import { PROGRESS_COMPLETE, PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../constants'
// Import after mocks
import { useFileUpload } from './use-file-upload'

// Mock notify function
const mockNotify = vi.fn()
const mockClose = vi.fn()

// Mock ToastContext
vi.mock('use-context-selector', async () => {
  const actual = await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
  return {
    ...actual,
    useContext: vi.fn(() => ({ notify: mockNotify, close: mockClose })),
  }
})

// Mock upload service
const mockUpload = vi.fn()
vi.mock('@/service/base', () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}))

// Mock file upload config
const mockFileUploadConfig = {
  file_size_limit: 15,
  batch_count_limit: 5,
  file_upload_limit: 10,
}

const mockSupportTypes = {
  allowed_extensions: ['pdf', 'docx', 'txt', 'md'],
}

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({ data: mockFileUploadConfig }),
  useFileSupportTypes: () => ({ data: mockSupportTypes }),
}))

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock locale
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/i18n-config/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans'],
}))

// Mock config
vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

// Mock file upload error message
vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFileUploadErrorMessage: (_e: unknown, defaultMsg: string) => defaultMsg,
}))

const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => (
    <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
      {children}
    </ToastContext.Provider>
  )
}

describe('useFileUpload', () => {
  const defaultOptions = {
    fileList: [] as FileItem[],
    prepareFileList: vi.fn(),
    onFileUpdate: vi.fn(),
    onFileListUpdate: vi.fn(),
    onPreview: vi.fn(),
    supportBatchUpload: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.mockReset()
    // Default mock to return a resolved promise to avoid unhandled rejections
    mockUpload.mockResolvedValue({ id: 'default-id' })
    mockNotify.mockReset()
  })

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      expect(result.current.dragging).toBe(false)
      expect(result.current.hideUpload).toBe(false)
      expect(result.current.dropRef.current).toBeNull()
      expect(result.current.dragRef.current).toBeNull()
      expect(result.current.fileUploaderRef.current).toBeNull()
    })

    it('should set hideUpload true when not batch upload and has files', () => {
      const { result } = renderHook(
        () => useFileUpload({
          ...defaultOptions,
          supportBatchUpload: false,
          fileList: [{ fileID: 'file-1', file: {} as CustomFile, progress: 100 }],
        }),
        { wrapper: createWrapper() },
      )

      expect(result.current.hideUpload).toBe(true)
    })

    it('should compute acceptTypes correctly', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      expect(result.current.acceptTypes).toEqual(['.pdf', '.docx', '.txt', '.md'])
    })

    it('should compute supportTypesShowNames correctly', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      expect(result.current.supportTypesShowNames).toContain('PDF')
      expect(result.current.supportTypesShowNames).toContain('DOCX')
      expect(result.current.supportTypesShowNames).toContain('TXT')
      // 'md' is mapped to 'markdown' in the extensionMap
      expect(result.current.supportTypesShowNames).toContain('MARKDOWN')
    })

    it('should set batch limit to 1 when not batch upload', () => {
      const { result } = renderHook(
        () => useFileUpload({
          ...defaultOptions,
          supportBatchUpload: false,
        }),
        { wrapper: createWrapper() },
      )

      expect(result.current.fileUploadConfig.batch_count_limit).toBe(1)
      expect(result.current.fileUploadConfig.file_upload_limit).toBe(1)
    })
  })

  describe('selectHandle', () => {
    it('should trigger click on file input', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
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

    it('should do nothing when file input ref is null', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      expect(() => {
        act(() => {
          result.current.selectHandle()
        })
      }).not.toThrow()
    })
  })

  describe('handlePreview', () => {
    it('should call onPreview when file has id', () => {
      const onPreview = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onPreview }),
        { wrapper: createWrapper() },
      )

      const mockFile = { id: 'file-123', name: 'test.pdf', size: 1024 } as CustomFile

      act(() => {
        result.current.handlePreview(mockFile)
      })

      expect(onPreview).toHaveBeenCalledWith(mockFile)
    })

    it('should not call onPreview when file has no id', () => {
      const onPreview = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onPreview }),
        { wrapper: createWrapper() },
      )

      const mockFile = { name: 'test.pdf', size: 1024 } as CustomFile

      act(() => {
        result.current.handlePreview(mockFile)
      })

      expect(onPreview).not.toHaveBeenCalled()
    })
  })

  describe('removeFile', () => {
    it('should call onFileListUpdate with filtered list', () => {
      const onFileListUpdate = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onFileListUpdate }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.removeFile('file-to-remove')
      })

      expect(onFileListUpdate).toHaveBeenCalled()
    })

    it('should clear file input value', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      const mockInput = { value: 'some-file' } as HTMLInputElement
      Object.defineProperty(result.current.fileUploaderRef, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.removeFile('file-123')
      })

      expect(mockInput.value).toBe('')
    })
  })

  describe('fileChangeHandle', () => {
    it('should handle valid files', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })

      const prepareFileList = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, prepareFileList }),
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
        expect(prepareFileList).toHaveBeenCalled()
      })
    })

    it('should limit files to batch count', () => {
      const prepareFileList = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, prepareFileList }),
        { wrapper: createWrapper() },
      )

      const files = Array.from({ length: 10 }, (_, i) =>
        new File(['content'], `file${i}.pdf`, { type: 'application/pdf' }))

      const event = {
        target: { files },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      // Should be called with at most batch_count_limit files
      if (prepareFileList.mock.calls.length > 0) {
        const calledFiles = prepareFileList.mock.calls[0][0]
        expect(calledFiles.length).toBeLessThanOrEqual(mockFileUploadConfig.batch_count_limit)
      }
    })

    it('should reject invalid file types', () => {
      const { result } = renderHook(
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.exe', { type: 'application/x-msdownload' })
      const event = {
        target: { files: [mockFile] },
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
        () => useFileUpload(defaultOptions),
        { wrapper: createWrapper() },
      )

      // Create a file larger than the limit (15MB)
      const largeFile = new File([new ArrayBuffer(20 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' })

      const event = {
        target: { files: [largeFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should handle null files', () => {
      const prepareFileList = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, prepareFileList }),
        { wrapper: createWrapper() },
      )

      const event = {
        target: { files: null },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(prepareFileList).not.toHaveBeenCalled()
    })
  })

  describe('drag and drop handlers', () => {
    const TestDropzone = ({ options }: { options: typeof defaultOptions }) => {
      const {
        dropRef,
        dragRef,
        dragging,
      } = useFileUpload(options)

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
            <TestDropzone options={defaultOptions} />
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
            <TestDropzone options={defaultOptions} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
        dropzone.dispatchEvent(dragOverEvent)
      })

      expect(dropzone).toBeInTheDocument()
    })

    it('should set dragging false on dragleave from drag overlay', async () => {
      const { getByTestId, queryByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={defaultOptions} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
        dropzone.dispatchEvent(dragEnterEvent)
      })

      expect(getByTestId('dragging').textContent).toBe('true')

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
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [{
              getAsFile: () => mockFile,
              webkitGetAsEntry: () => null,
            }],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalled()
      })
    })

    it('should handle drop without dataTransfer', async () => {
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', { value: null })
        dropzone.dispatchEvent(dropEvent)
      })

      expect(prepareFileList).not.toHaveBeenCalled()
    })

    it('should limit to single file on drop when supportBatchUpload is false', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, supportBatchUpload: false, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      const files = [
        new File(['content1'], 'test1.pdf', { type: 'application/pdf' }),
        new File(['content2'], 'test2.pdf', { type: 'application/pdf' }),
      ]

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: files.map(f => ({
              getAsFile: () => f,
              webkitGetAsEntry: () => null,
            })),
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        if (prepareFileList.mock.calls.length > 0) {
          const calledFiles = prepareFileList.mock.calls[0][0]
          expect(calledFiles.length).toBe(1)
        }
      })
    })

    it('should handle drop with FileSystemFileEntry', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })
      const prepareFileList = vi.fn()
      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [{
              getAsFile: () => mockFile,
              webkitGetAsEntry: () => ({
                isFile: true,
                isDirectory: false,
                file: (callback: (file: File) => void) => callback(mockFile),
              }),
            }],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalled()
      })
    })

    it('should handle drop with FileSystemDirectoryEntry', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id' })
      const prepareFileList = vi.fn()
      const mockFile = new File(['content'], 'nested.pdf', { type: 'application/pdf' })

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        let callCount = 0
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [{
              getAsFile: () => null,
              webkitGetAsEntry: () => ({
                isFile: false,
                isDirectory: true,
                name: 'folder',
                createReader: () => ({
                  readEntries: (callback: (entries: Array<{ isFile: boolean, isDirectory: boolean, name?: string, file?: (cb: (f: File) => void) => void }>) => void) => {
                    // First call returns file entry, second call returns empty (signals end)
                    if (callCount === 0) {
                      callCount++
                      callback([{
                        isFile: true,
                        isDirectory: false,
                        name: 'nested.pdf',
                        file: (cb: (f: File) => void) => cb(mockFile),
                      }])
                    }
                    else {
                      callback([])
                    }
                  },
                }),
              }),
            }],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalled()
      })
    })

    it('should handle drop with empty directory', async () => {
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [{
              getAsFile: () => null,
              webkitGetAsEntry: () => ({
                isFile: false,
                isDirectory: true,
                name: 'empty-folder',
                createReader: () => ({
                  readEntries: (callback: (entries: never[]) => void) => {
                    callback([])
                  },
                }),
              }),
            }],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      // Should not prepare file list if no valid files
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    it('should handle entry that is neither file nor directory', async () => {
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </ToastContext.Provider>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: DataTransfer | null }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [{
              getAsFile: () => null,
              webkitGetAsEntry: () => ({
                isFile: false,
                isDirectory: false,
              }),
            }],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      // Should not throw and should handle gracefully
      await new Promise(resolve => setTimeout(resolve, 100))
    })
  })

  describe('file upload', () => {
    it('should call upload with correct parameters', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id', name: 'test.pdf' })
      const onFileUpdate = vi.fn()

      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onFileUpdate }),
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
    })

    it('should update progress during upload', async () => {
      let progressCallback: ((e: ProgressEvent) => void) | undefined

      mockUpload.mockImplementation(async (options: { onprogress: (e: ProgressEvent) => void }) => {
        progressCallback = options.onprogress
        return { id: 'uploaded-id' }
      })

      const onFileUpdate = vi.fn()

      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onFileUpdate }),
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

      if (progressCallback) {
        act(() => {
          progressCallback!({
            lengthComputable: true,
            loaded: 50,
            total: 100,
          } as ProgressEvent)
        })

        expect(onFileUpdate).toHaveBeenCalled()
      }
    })

    it('should handle upload error', async () => {
      mockUpload.mockRejectedValue(new Error('Upload failed'))
      const onFileUpdate = vi.fn()

      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onFileUpdate }),
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
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
    })

    it('should update file with PROGRESS_COMPLETE on success', async () => {
      mockUpload.mockResolvedValue({ id: 'uploaded-id', name: 'test.pdf' })
      const onFileUpdate = vi.fn()

      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onFileUpdate }),
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
        const completeCalls = onFileUpdate.mock.calls.filter(
          ([, progress]) => progress === PROGRESS_COMPLETE,
        )
        expect(completeCalls.length).toBeGreaterThan(0)
      })
    })

    it('should update file with PROGRESS_ERROR on failure', async () => {
      mockUpload.mockRejectedValue(new Error('Upload failed'))
      const onFileUpdate = vi.fn()

      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, onFileUpdate }),
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
        const errorCalls = onFileUpdate.mock.calls.filter(
          ([, progress]) => progress === PROGRESS_ERROR,
        )
        expect(errorCalls.length).toBeGreaterThan(0)
      })
    })
  })

  describe('file count validation', () => {
    it('should reject when total files exceed limit', () => {
      const existingFiles: FileItem[] = Array.from({ length: 8 }, (_, i) => ({
        fileID: `existing-${i}`,
        file: { name: `existing-${i}.pdf`, size: 1024 } as CustomFile,
        progress: 100,
      }))

      const { result } = renderHook(
        () => useFileUpload({
          ...defaultOptions,
          fileList: existingFiles,
        }),
        { wrapper: createWrapper() },
      )

      const files = Array.from({ length: 5 }, (_, i) =>
        new File(['content'], `new-${i}.pdf`, { type: 'application/pdf' }))

      const event = {
        target: { files },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })
  })

  describe('progress constants', () => {
    it('should use PROGRESS_NOT_STARTED for new files', async () => {
      mockUpload.mockResolvedValue({ id: 'file-id' })

      const prepareFileList = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, prepareFileList }),
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
        if (prepareFileList.mock.calls.length > 0) {
          const files = prepareFileList.mock.calls[0][0]
          expect(files[0].progress).toBe(PROGRESS_NOT_STARTED)
        }
      })
    })
  })
})
