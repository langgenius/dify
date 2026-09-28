import type { CustomFile as File, FileItem } from '@/models/datasets'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { PROGRESS_COMPLETE, PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../constants'
import FileUploader from '../index'

const render = (ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryOptions().queryKey, {
    allowed_extensions: ['pdf', 'docx', 'txt'],
  })
  return renderWithConsoleQuery(ui, {
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
}

const mockNotify = vi.fn()
vi.mock('use-context-selector', async () => {
  const actual =
    await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
  return {
    ...actual,
    useContext: vi.fn(() => ({ notify: mockNotify })),
  }
})

// Mock services
vi.mock('@/service/base', () => ({
  upload: vi.fn().mockResolvedValue({ id: 'uploaded-id' }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: { file_size_limit: 15, batch_count_limit: 5, file_upload_limit: 10 },
  }),
}))
vi.mock('@/i18n/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans'],
}))

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFileUploadErrorMessage: () => 'Upload error',
}))

// Mock theme
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/types/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/types/app')>()),
  Theme: { dark: 'dark', light: 'light' },
}))

// Mock DocumentFileIcon - uses relative path from file-list-item.tsx
vi.mock('@/app/components/datasets/common/document-file-icon', () => ({
  default: ({ extension }: { extension: string }) => (
    <div data-testid="document-icon">{extension}</div>
  ),
}))

// Mock SimplePieChart
vi.mock('next/dynamic', () => ({
  default: () => {
    const Component = ({ percentage }: { percentage: number }) => (
      <div data-testid="pie-chart">{percentage}%</div>
    )
    return Component
  },
}))

describe('FileUploader', () => {
  const createMockFile = (overrides: Partial<File> = {}): File =>
    ({
      name: 'test.pdf',
      size: 1024,
      type: 'application/pdf',
      ...overrides,
    }) as File

  const createMockFileItem = (overrides: Partial<FileItem> = {}): FileItem => ({
    fileID: `file-${Date.now()}`,
    file: createMockFile(overrides.file as Partial<File>),
    progress: PROGRESS_NOT_STARTED,
    ...overrides,
  })

  const defaultProps = {
    fileList: [] as FileItem[],
    prepareFileList: vi.fn(),
    onFileUpdate: vi.fn(),
    onFileListUpdate: vi.fn(),
    onPreview: vi.fn(),
    supportBatchUpload: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the component', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByText('datasetCreation.stepOne.uploader.title')).toBeInTheDocument()
    })

    it('should render dropzone when no files', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByText(/datasetCreation\.stepOne\.uploader\.button/)).toBeInTheDocument()
    })

    it('should render browse button', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByText('datasetCreation.stepOne.uploader.browse')).toBeInTheDocument()
    })
  })

  describe('file list rendering', () => {
    it('should render file items when fileList has items', () => {
      const fileList = [
        createMockFileItem({ file: createMockFile({ name: 'file1.pdf' }) }),
        createMockFileItem({ file: createMockFile({ name: 'file2.pdf' }) }),
      ]

      render(<FileUploader {...defaultProps} fileList={fileList} />)

      expect(screen.getByText('file1.pdf')).toBeInTheDocument()
      expect(screen.getByText('file2.pdf')).toBeInTheDocument()
    })

    it('should render document icons for files', () => {
      const fileList = [createMockFileItem()]
      render(<FileUploader {...defaultProps} fileList={fileList} />)

      expect(screen.getByTestId('document-icon')).toBeInTheDocument()
    })
  })

  describe('batch upload mode', () => {
    it('should show dropzone with batch upload enabled', () => {
      render(<FileUploader {...defaultProps} supportBatchUpload={true} />)
      expect(screen.getByText(/datasetCreation\.stepOne\.uploader\.button/)).toBeInTheDocument()
    })

    it('should show single file text when batch upload disabled', () => {
      render(<FileUploader {...defaultProps} supportBatchUpload={false} />)
      expect(
        screen.getByText(/datasetCreation\.stepOne\.uploader\.buttonSingleFile/),
      ).toBeInTheDocument()
    })

    it('should hide dropzone when not batch upload and has files', () => {
      const fileList = [createMockFileItem()]
      render(<FileUploader {...defaultProps} supportBatchUpload={false} fileList={fileList} />)

      expect(
        screen.queryByText(/datasetCreation\.stepOne\.uploader\.button/),
      ).not.toBeInTheDocument()
    })
  })

  describe('event handlers', () => {
    it('should handle file preview click', async () => {
      const user = userEvent.setup()
      const onPreview = vi.fn()
      const fileItem = createMockFileItem({
        file: createMockFile({ id: 'file-id' } as Partial<File>),
      })

      render(<FileUploader {...defaultProps} fileList={[fileItem]} onPreview={onPreview} />)

      await user.click(
        screen.getByRole('button', { name: 'datasetCreation.stepOne.filePreview test.pdf' }),
      )

      expect(onPreview).toHaveBeenCalledWith(fileItem.file)
    })

    it('should handle file remove click', () => {
      const onFileListUpdate = vi.fn()
      const fileItem = createMockFileItem()

      const { container } = render(
        <FileUploader
          {...defaultProps}
          fileList={[fileItem]}
          onFileListUpdate={onFileListUpdate}
        />,
      )

      // Find the delete button (the span with cursor-pointer containing the icon)
      const deleteButtons = container.querySelectorAll('[class*="cursor-pointer"]')
      // Get the last one which should be the delete button (not the browse label)
      const deleteButton = deleteButtons[deleteButtons.length - 1]
      if (deleteButton) fireEvent.click(deleteButton)

      expect(onFileListUpdate).toHaveBeenCalled()
    })

    it('should handle browse button click', () => {
      render(<FileUploader {...defaultProps} />)

      // The browse label should trigger file input click
      const browseLabel = screen.getByText('datasetCreation.stepOne.uploader.browse')
      expect(browseLabel).toHaveClass('cursor-pointer')
    })
  })

  describe('upload announcements', () => {
    it('keeps a live status mounted before any upload starts', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('keeps progress announcements stable until the server confirms the file', () => {
      const fileItem = createMockFileItem({ fileID: 'upload-1', progress: 0 })
      const { rerender } = render(<FileUploader {...defaultProps} fileList={[fileItem]} />)
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('test.pdf: common.loading')

      for (const progress of [25, 75, PROGRESS_COMPLETE]) {
        rerender(<FileUploader {...defaultProps} fileList={[{ ...fileItem, progress }]} />)
        expect(screen.getByRole('status')).toHaveTextContent('test.pdf: common.loading')
        expect(screen.getByRole('status')).not.toHaveTextContent(
          'datasetCreation.stepOne.uploader.completed',
        )
      }

      rerender(
        <FileUploader
          {...defaultProps}
          fileList={[
            {
              ...fileItem,
              progress: PROGRESS_COMPLETE,
              file: createMockFile({ id: 'server-file-id' }),
            },
          ]}
        />,
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        'test.pdf: datasetCreation.stepOne.uploader.completed',
      )
      expect(screen.getByRole('status')).not.toHaveTextContent('common.loading')
    })

    it('announces failed and completed files by name within a batch', () => {
      const pendingFiles = [
        createMockFileItem({
          fileID: 'upload-1',
          file: createMockFile({ name: 'first.pdf' }),
          progress: 10,
        }),
        createMockFileItem({
          fileID: 'upload-2',
          file: createMockFile({ name: 'second.pdf' }),
          progress: 20,
        }),
      ]
      const { rerender } = render(<FileUploader {...defaultProps} fileList={pendingFiles} />)
      rerender(
        <FileUploader
          {...defaultProps}
          fileList={[
            { ...pendingFiles[0]!, progress: PROGRESS_ERROR },
            {
              ...pendingFiles[1]!,
              progress: PROGRESS_COMPLETE,
              file: createMockFile({ name: 'second.pdf', id: 'second-server-id' }),
            },
          ]}
        />,
      )
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('first.pdf: datasetCreation.stepOne.uploader.failed')
      expect(status).toHaveTextContent('second.pdf: datasetCreation.stepOne.uploader.completed')
      expect(status).toHaveAttribute('aria-atomic', 'false')
    })
  })

  describe('upload progress', () => {
    it('should show progress chart for uploading files', () => {
      const fileItem = createMockFileItem({ progress: 50 })
      render(<FileUploader {...defaultProps} fileList={[fileItem]} />)

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument()
      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('should not show progress chart for completed files', () => {
      const fileItem = createMockFileItem({ progress: 100 })
      render(<FileUploader {...defaultProps} fileList={[fileItem]} />)

      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument()
    })

    it('should not show progress chart for not started files', () => {
      const fileItem = createMockFileItem({ progress: PROGRESS_NOT_STARTED })
      render(<FileUploader {...defaultProps} fileList={[fileItem]} />)

      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument()
    })
  })

  describe('multiple files', () => {
    it('should render all files in the list', () => {
      const fileList = [
        createMockFileItem({ fileID: 'f1', file: createMockFile({ name: 'doc1.pdf' }) }),
        createMockFileItem({ fileID: 'f2', file: createMockFile({ name: 'doc2.docx' }) }),
        createMockFileItem({ fileID: 'f3', file: createMockFile({ name: 'doc3.txt' }) }),
      ]

      render(<FileUploader {...defaultProps} fileList={fileList} />)

      expect(screen.getByText('doc1.pdf')).toBeInTheDocument()
      expect(screen.getByText('doc2.docx')).toBeInTheDocument()
      expect(screen.getByText('doc3.txt')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should have proper spacing', () => {
      const { container } = render(<FileUploader {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('mb-5')
    })
  })
})
