import type { ReactElement } from 'react'
import type { CustomFile, FileItem } from '@/models/datasets'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  renderWithConsoleQuery,
} from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { PROGRESS_COMPLETE, PROGRESS_ERROR } from '../../constants'
// Import after mocks
import { useFileUpload } from '../use-file-upload'

// Mock notify function
const mockNotify = vi.fn()

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

// Mock upload service
const mockUpload = vi.fn()
const request = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())
vi.mock('@/service/base', () => ({
  request,
  upload: (...args: unknown[]) => mockUpload(...args),
}))

// Mock file upload config
const fileUploadConfig = createFileUploadConfigFixture({
  file_size_limit: 15,
  knowledge_file_size_limit: 50,
  batch_count_limit: 5,
  file_upload_limit: 10,
})

const supportedFormats = {
  allowed_extensions: ['pdf', 'docx', 'txt', 'md'],
}

vi.mock('@/i18n/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans'],
}))

// Mock file upload error message

const createQueryClient = () => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.files.upload.get.queryKey(), fileUploadConfig)
  queryClient.setQueryData(
    consoleQuery.files.supportType.get.queryOptions().queryKey,
    supportedFormats,
  )
  return queryClient
}
const createWrapper = () =>
  createConsoleQueryWrapper({
    queryClient: createQueryClient(),
    systemFeatures: { deployment_edition: 'CLOUD' },
  }).wrapper
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    queryClient: createQueryClient(),
    systemFeatures: { deployment_edition: 'CLOUD' },
  })

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
    it('should set hideUpload true when not batch upload and has files', () => {
      const { result } = renderHook(
        () =>
          useFileUpload({
            ...defaultOptions,
            supportBatchUpload: false,
            fileList: [{ fileID: 'file-1', file: {} as CustomFile, progress: 100 }],
          }),
        { wrapper: createWrapper() },
      )

      expect(result.current.hideUpload).toBe(true)
    })

    it('should compute acceptTypes correctly', () => {
      const { result } = renderHook(() => useFileUpload(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.acceptTypes).toEqual(['.pdf', '.docx', '.txt', '.md'])
    })

    it('should compute supportTypesShowNames correctly', () => {
      const { result } = renderHook(() => useFileUpload(defaultOptions), {
        wrapper: createWrapper(),
      })

      expect(result.current.supportTypesShowNames).toContain('PDF')
      expect(result.current.supportTypesShowNames).toContain('DOCX')
      expect(result.current.supportTypesShowNames).toContain('TXT')
      // 'md' is mapped to 'markdown' in the extensionMap
      expect(result.current.supportTypesShowNames).toContain('MARKDOWN')
    })

    it('should set batch limit to 1 when not batch upload', () => {
      const { result } = renderHook(
        () =>
          useFileUpload({
            ...defaultOptions,
            supportBatchUpload: false,
          }),
        { wrapper: createWrapper() },
      )

      expect(result.current.fileUploadConfig.batch_count_limit).toBe(1)
      expect(result.current.fileUploadConfig.file_upload_limit).toBe(1)
    })
  })

  it.each([
    { allowedExtensions: ['csv'], expectedAccept: '.csv', uploadCount: 1 },
    { allowedExtensions: [], expectedAccept: '', uploadCount: 0 },
  ])(
    'keeps the explicit $allowedExtensions override while subscribing to supported formats',
    async ({ allowedExtensions, expectedAccept, uploadCount }) => {
      const queryClient = createConsoleQueryClient()
      queryClient.setQueryData(consoleQuery.files.upload.get.queryKey(), fileUploadConfig)
      request.mockImplementation(async () => Response.json(supportedFormats))
      const Uploader = () => {
        const { fileUploaderRef, fileChangeHandle, acceptTypes } = useFileUpload({
          ...defaultOptions,
          allowedExtensions,
        })
        return (
          <input
            aria-label="Upload file"
            type="file"
            ref={fileUploaderRef}
            accept={acceptTypes.join(',')}
            onChange={fileChangeHandle}
          />
        )
      }
      renderWithConsoleQuery(<Uploader />, {
        queryClient,
        systemFeatures: { deployment_edition: 'CLOUD' },
      })
      const input = screen.getByLabelText('Upload file')
      expect(input).toHaveAttribute('accept', expectedAccept)

      await waitFor(() =>
        expect(
          queryClient.getQueryData(consoleQuery.files.supportType.get.queryOptions().queryKey),
        ).toEqual(supportedFormats),
      )

      expect(request).toHaveBeenCalledTimes(1)
      expect(input).toHaveAttribute('accept', expectedAccept)
      fireEvent.change(input, {
        target: { files: [new File(['row'], 'data.csv', { type: 'text/csv' })] },
      })
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(uploadCount))
      if (uploadCount === 0) {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.uploader.validation.typeError',
        })
        expect(defaultOptions.prepareFileList).not.toHaveBeenCalled()
      } else {
        expect(defaultOptions.prepareFileList).toHaveBeenCalledOnce()
        expect(defaultOptions.onFileUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ file: { id: 'default-id' } }),
          PROGRESS_COMPLETE,
          expect.any(Array),
        )
        expect(mockNotify).not.toHaveBeenCalled()
      }
    },
  )

  describe('handlePreview', () => {
    it('should call onPreview when file has id', () => {
      const onPreview = vi.fn()
      const { result } = renderHook(() => useFileUpload({ ...defaultOptions, onPreview }), {
        wrapper: createWrapper(),
      })

      const mockFile = { id: 'file-123', name: 'test.pdf', size: 1024 } as CustomFile

      act(() => {
        result.current.handlePreview(mockFile)
      })

      expect(onPreview).toHaveBeenCalledWith(mockFile)
    })

    it('should not call onPreview when file has no id', () => {
      const onPreview = vi.fn()
      const { result } = renderHook(() => useFileUpload({ ...defaultOptions, onPreview }), {
        wrapper: createWrapper(),
      })

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
      const { result } = renderHook(() => useFileUpload({ ...defaultOptions, onFileListUpdate }), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.removeFile('file-to-remove')
      })

      expect(onFileListUpdate).toHaveBeenCalled()
    })
  })

  describe('fileChangeHandle', () => {
    it('keeps previously uploaded files when adding another file after remount', () => {
      const existingFile: FileItem = {
        fileID: 'existing',
        file: { id: 'existing-id', name: 'existing.pdf', size: 1024 } as CustomFile,
        progress: PROGRESS_COMPLETE,
      }
      const prepareFileList = vi.fn()
      const { result } = renderHook(
        () => useFileUpload({ ...defaultOptions, fileList: [existingFile], prepareFileList }),
        { wrapper: createWrapper() },
      )

      const newFile = new File(['content'], 'new.pdf', { type: 'application/pdf' })
      const event = {
        target: { files: [newFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(prepareFileList).toHaveBeenCalledWith([
        existingFile,
        expect.objectContaining({ file: newFile }),
      ])
    })

    it('should reject invalid file types', () => {
      const { result } = renderHook(() => useFileUpload(defaultOptions), {
        wrapper: createWrapper(),
      })

      const mockFile = new File(['content'], 'test.exe', { type: 'application/x-msdownload' })
      const event = {
        target: { files: [mockFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should reject files exceeding size limit', () => {
      const { result } = renderHook(() => useFileUpload(defaultOptions), {
        wrapper: createWrapper(),
      })

      const largeFile = new File(['content'], 'large.pdf', { type: 'application/pdf' })
      Object.defineProperty(largeFile, 'size', { value: 51 * 1024 * 1024 })

      const event = {
        target: { files: [largeFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should handle null files', () => {
      const prepareFileList = vi.fn()
      const { result } = renderHook(() => useFileUpload({ ...defaultOptions, prepareFileList }), {
        wrapper: createWrapper(),
      })

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
      const { dropRef, dragRef, dragging } = useFileUpload(options)

      return (
        <div>
          <div ref={dropRef} data-testid="dropzone">
            {dragging && <div ref={dragRef} data-testid="drag-overlay" />}
          </div>
          <span data-testid="dragging">{String(dragging)}</span>
        </div>
      )
    }

    it('should set dragging false on dragleave from drag overlay', async () => {
      const { getByTestId, queryByTestId } = await act(async () =>
        render(
          <>
            <TestDropzone options={defaultOptions} />
          </>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
        dropzone.dispatchEvent(dragEnterEvent)
      })

      expect(getByTestId('dragging').textContent).toBe('true')

      fireEvent.dragLeave(getByTestId('drag-overlay'))
      expect(queryByTestId('drag-overlay')).not.toBeInTheDocument()
      expect(getByTestId('dragging')).toHaveTextContent('false')
    })

    it('should handle drop with files', async () => {
      // Keep upload pending so the prepared local files can be inspected before replacement.
      mockUpload.mockImplementation(() => new Promise(() => {}))
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: DataTransfer | null
        }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [
              {
                getAsFile: () => mockFile,
                webkitGetAsEntry: () => null,
              },
            ],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalledWith([expect.objectContaining({ file: mockFile })])
      })
    })

    it('should limit to single file on drop when supportBatchUpload is false', async () => {
      // Keep upload pending so the prepared local files can be inspected before replacement.
      mockUpload.mockImplementation(() => new Promise(() => {}))
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <>
            <TestDropzone
              options={{ ...defaultOptions, supportBatchUpload: false, prepareFileList }}
            />
          </>,
        ),
      )

      const dropzone = getByTestId('dropzone')
      const files = [
        new File(['content1'], 'test1.pdf', { type: 'application/pdf' }),
        new File(['content2'], 'test2.pdf', { type: 'application/pdf' }),
      ]

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: DataTransfer | null
        }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: files.map((f) => ({
              getAsFile: () => f,
              webkitGetAsEntry: () => null,
            })),
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalledWith([expect.objectContaining({ file: files[0] })])
      })
    })

    it('should handle drop with FileSystemFileEntry', async () => {
      // Keep upload pending so the prepared local files can be inspected before replacement.
      mockUpload.mockImplementation(() => new Promise(() => {}))
      const prepareFileList = vi.fn()
      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' })

      const { getByTestId } = await act(async () =>
        render(
          <>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: DataTransfer | null
        }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [
              {
                getAsFile: () => mockFile,
                webkitGetAsEntry: () => ({
                  isFile: true,
                  isDirectory: false,
                  file: (callback: (file: File) => void) => callback(mockFile),
                }),
              },
            ],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalledWith([expect.objectContaining({ file: mockFile })])
      })
    })

    it('should handle drop with FileSystemDirectoryEntry', async () => {
      // Keep upload pending so the prepared local files can be inspected before replacement.
      mockUpload.mockImplementation(() => new Promise(() => {}))
      const prepareFileList = vi.fn()
      const mockFile = new File(['content'], 'nested.pdf', { type: 'application/pdf' })

      const { getByTestId } = await act(async () =>
        render(
          <>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        let callCount = 0
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: DataTransfer | null
        }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [
              {
                getAsFile: () => null,
                webkitGetAsEntry: () => ({
                  isFile: false,
                  isDirectory: true,
                  name: 'folder',
                  createReader: () => ({
                    readEntries: (
                      callback: (
                        entries: Array<{
                          isFile: boolean
                          isDirectory: boolean
                          name?: string
                          file?: (cb: (f: File) => void) => void
                        }>,
                      ) => void,
                    ) => {
                      // First call returns file entry, second call returns empty (signals end)
                      if (callCount === 0) {
                        callCount++
                        callback([
                          {
                            isFile: true,
                            isDirectory: false,
                            name: 'nested.pdf',
                            file: (cb: (f: File) => void) => cb(mockFile),
                          },
                        ])
                      } else {
                        callback([])
                      }
                    },
                  }),
                }),
              },
            ],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(prepareFileList).toHaveBeenCalledWith([expect.objectContaining({ file: mockFile })])
      })
    })

    it('should handle drop with empty directory', async () => {
      const prepareFileList = vi.fn()

      const { getByTestId } = await act(async () =>
        render(
          <>
            <TestDropzone options={{ ...defaultOptions, prepareFileList }} />
          </>,
        ),
      )

      const dropzone = getByTestId('dropzone')

      await act(async () => {
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
          dataTransfer: DataTransfer | null
        }
        Object.defineProperty(dropEvent, 'dataTransfer', {
          value: {
            items: [
              {
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
              },
            ],
          },
        })
        dropzone.dispatchEvent(dropEvent)
      })

      expect(prepareFileList).not.toHaveBeenCalled()
      expect(mockUpload).not.toHaveBeenCalled()
    })
  })

  describe('file upload', () => {
    it('uploads the selected file with progress and replaces it with the server response', async () => {
      let resolve!: (value: { id: string; name: string }) => void
      mockUpload.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolve = res
          }),
      )
      const onFileUpdate = vi.fn()
      const { result } = renderHook(() => useFileUpload({ ...defaultOptions, onFileUpdate }), {
        wrapper: createWrapper(),
      })
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      act(() =>
        result.current.fileChangeHandle({
          target: { files: [file] },
        } as unknown as React.ChangeEvent<HTMLInputElement>),
      )
      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({ xhr: expect.any(XMLHttpRequest), data: expect.any(FormData) }),
        false,
        undefined,
        '?source=datasets',
      )
      const options = mockUpload.mock.lastCall![0]
      expect(options.data.get('file').name).toBe('test.pdf')
      act(() =>
        options.onprogress(
          new ProgressEvent('progress', { lengthComputable: true, loaded: 53, total: 100 }),
        ),
      )
      expect(onFileUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ file }),
        53,
        expect.any(Array),
      )
      onFileUpdate.mockClear()
      act(() => options.onprogress(new ProgressEvent('progress', { lengthComputable: false })))
      expect(onFileUpdate).not.toHaveBeenCalled()
      const response = { id: 'uploaded-id', name: 'test.pdf' }
      await act(async () => resolve(response))
      expect(onFileUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ file: response }),
        PROGRESS_COMPLETE,
        expect.any(Array),
      )
    })

    it('should update file with PROGRESS_ERROR on failure', async () => {
      mockUpload.mockRejectedValue(new Error('Upload failed'))
      const onFileUpdate = vi.fn()

      const { result } = renderHook(() => useFileUpload({ ...defaultOptions, onFileUpdate }), {
        wrapper: createWrapper(),
      })

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
        expect(errorCalls).toEqual([
          [expect.objectContaining({ file: mockFile }), PROGRESS_ERROR, expect.any(Array)],
        ])
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.uploader.failed',
        })
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
        () =>
          useFileUpload({
            ...defaultOptions,
            fileList: existingFiles,
          }),
        { wrapper: createWrapper() },
      )

      const files = Array.from(
        { length: 5 },
        (_, i) => new File(['content'], `new-${i}.pdf`, { type: 'application/pdf' }),
      )

      const event = {
        target: { files },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle(event)
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
  })
})
