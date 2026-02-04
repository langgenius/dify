import type { CustomFile as File, FileItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROGRESS_NOT_STARTED } from './constants'
import FileUploader from './index'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'stepOne.uploader.title': 'Upload Files',
        'stepOne.uploader.button': 'Drag and drop files, or',
        'stepOne.uploader.buttonSingleFile': 'Drag and drop file, or',
        'stepOne.uploader.browse': 'Browse',
        'stepOne.uploader.tip': 'Supports various file types',
      }
      return translations[key] || key
    },
  }),
}))

// Mock ToastContext
const mockNotify = vi.fn()
vi.mock('use-context-selector', async () => {
  const actual = await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
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
  useFileSupportTypes: () => ({
    data: { allowed_extensions: ['pdf', 'docx', 'txt'] },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/i18n-config/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans'],
}))

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFileUploadErrorMessage: () => 'Upload error',
}))

// Mock theme
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/types/app', () => ({
  Theme: { dark: 'dark', light: 'light' },
}))

// Mock DocumentFileIcon - uses relative path from file-list-item.tsx
vi.mock('@/app/components/datasets/common/document-file-icon', () => ({
  default: ({ extension }: { extension: string }) => <div data-testid="document-icon">{extension}</div>,
}))

// Mock SimplePieChart
vi.mock('next/dynamic', () => ({
  default: () => {
    const Component = ({ percentage }: { percentage: number }) => (
      <div data-testid="pie-chart">
        {percentage}
        %
      </div>
    )
    return Component
  },
}))

describe('FileUploader', () => {
  const createMockFile = (overrides: Partial<File> = {}): File => ({
    name: 'test.pdf',
    size: 1024,
    type: 'application/pdf',
    ...overrides,
  } as File)

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
      expect(screen.getByText('Upload Files')).toBeInTheDocument()
    })

    it('should render dropzone when no files', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByText(/Drag and drop files/i)).toBeInTheDocument()
    })

    it('should render browse button', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByText('Browse')).toBeInTheDocument()
    })

    it('should apply custom title className', () => {
      render(<FileUploader {...defaultProps} titleClassName="custom-class" />)
      const title = screen.getByText('Upload Files')
      expect(title).toHaveClass('custom-class')
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
      expect(screen.getByText(/Drag and drop files/i)).toBeInTheDocument()
    })

    it('should show single file text when batch upload disabled', () => {
      render(<FileUploader {...defaultProps} supportBatchUpload={false} />)
      expect(screen.getByText(/Drag and drop file/i)).toBeInTheDocument()
    })

    it('should hide dropzone when not batch upload and has files', () => {
      const fileList = [createMockFileItem()]
      render(<FileUploader {...defaultProps} supportBatchUpload={false} fileList={fileList} />)

      expect(screen.queryByText(/Drag and drop/i)).not.toBeInTheDocument()
    })
  })

  describe('event handlers', () => {
    it('should handle file preview click', () => {
      const onPreview = vi.fn()
      const fileItem = createMockFileItem({
        file: createMockFile({ id: 'file-id' } as Partial<File>),
      })

      const { container } = render(<FileUploader {...defaultProps} fileList={[fileItem]} onPreview={onPreview} />)

      // Find the file list item container by its class pattern
      const fileElement = container.querySelector('[class*="flex h-12"]')
      if (fileElement)
        fireEvent.click(fileElement)

      expect(onPreview).toHaveBeenCalledWith(fileItem.file)
    })

    it('should handle file remove click', () => {
      const onFileListUpdate = vi.fn()
      const fileItem = createMockFileItem()

      const { container } = render(
        <FileUploader {...defaultProps} fileList={[fileItem]} onFileListUpdate={onFileListUpdate} />,
      )

      // Find the delete button (the span with cursor-pointer containing the icon)
      const deleteButtons = container.querySelectorAll('[class*="cursor-pointer"]')
      // Get the last one which should be the delete button (not the browse label)
      const deleteButton = deleteButtons[deleteButtons.length - 1]
      if (deleteButton)
        fireEvent.click(deleteButton)

      expect(onFileListUpdate).toHaveBeenCalled()
    })

    it('should handle browse button click', () => {
      render(<FileUploader {...defaultProps} />)

      // The browse label should trigger file input click
      const browseLabel = screen.getByText('Browse')
      expect(browseLabel).toHaveClass('cursor-pointer')
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
    it('should have correct container width', () => {
      const { container } = render(<FileUploader {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('w-[640px]')
    })

    it('should have proper spacing', () => {
      const { container } = render(<FileUploader {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('mb-5')
    })
  })
})
