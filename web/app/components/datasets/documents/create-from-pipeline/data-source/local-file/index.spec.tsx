import type { FileItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LocalFile from './index'

// Mock the hook
const mockUseLocalFileUpload = vi.fn()
vi.mock('./hooks/use-local-file-upload', () => ({
  useLocalFileUpload: (...args: unknown[]) => mockUseLocalFileUpload(...args),
}))

// Mock react-i18next for sub-components
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock theme hook for sub-components
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

// Mock theme types
vi.mock('@/types/app', () => ({
  Theme: { dark: 'dark', light: 'light' },
}))

// Mock DocumentFileIcon
vi.mock('@/app/components/datasets/common/document-file-icon', () => ({
  default: ({ name }: { name: string }) => <div data-testid="document-icon">{name}</div>,
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

describe('LocalFile', () => {
  const mockDropRef = { current: null }
  const mockDragRef = { current: null }
  const mockFileUploaderRef = { current: null }

  const defaultHookReturn = {
    dropRef: mockDropRef,
    dragRef: mockDragRef,
    fileUploaderRef: mockFileUploaderRef,
    dragging: false,
    localFileList: [] as FileItem[],
    fileUploadConfig: {
      file_size_limit: 15,
      batch_count_limit: 5,
      file_upload_limit: 10,
    },
    acceptTypes: ['.pdf', '.docx'],
    supportTypesShowNames: 'PDF, DOCX',
    hideUpload: false,
    selectHandle: vi.fn(),
    fileChangeHandle: vi.fn(),
    removeFile: vi.fn(),
    handlePreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLocalFileUpload.mockReturnValue(defaultHookReturn)
  })

  describe('rendering', () => {
    it('should render the component container', () => {
      const { container } = render(
        <LocalFile allowedExtensions={['pdf', 'docx']} />,
      )

      expect(container.firstChild).toHaveClass('flex', 'flex-col')
    })

    it('should render UploadDropzone when hideUpload is false', () => {
      render(<LocalFile allowedExtensions={['pdf']} />)

      const fileInput = document.getElementById('fileUploader')
      expect(fileInput).toBeInTheDocument()
    })

    it('should not render UploadDropzone when hideUpload is true', () => {
      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        hideUpload: true,
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      const fileInput = document.getElementById('fileUploader')
      expect(fileInput).not.toBeInTheDocument()
    })
  })

  describe('file list rendering', () => {
    it('should not render file list when empty', () => {
      render(<LocalFile allowedExtensions={['pdf']} />)

      expect(screen.queryByTestId('document-icon')).not.toBeInTheDocument()
    })

    it('should render file list when files exist', () => {
      const mockFile = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        localFileList: [
          {
            fileID: 'file-1',
            file: mockFile,
            progress: -1,
          },
        ],
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      expect(screen.getByTestId('document-icon')).toBeInTheDocument()
    })

    it('should render multiple file items', () => {
      const createMockFile = (name: string) => ({
        name,
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      }) as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        localFileList: [
          { fileID: 'file-1', file: createMockFile('doc1.pdf'), progress: -1 },
          { fileID: 'file-2', file: createMockFile('doc2.pdf'), progress: -1 },
          { fileID: 'file-3', file: createMockFile('doc3.pdf'), progress: -1 },
        ],
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      const icons = screen.getAllByTestId('document-icon')
      expect(icons).toHaveLength(3)
    })

    it('should use correct key for file items', () => {
      const mockFile = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        localFileList: [
          { fileID: 'unique-id-123', file: mockFile, progress: -1 },
        ],
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      // The component should render without errors (key is used internally)
      expect(screen.getByTestId('document-icon')).toBeInTheDocument()
    })
  })

  describe('hook integration', () => {
    it('should pass allowedExtensions to hook', () => {
      render(<LocalFile allowedExtensions={['pdf', 'docx', 'txt']} />)

      expect(mockUseLocalFileUpload).toHaveBeenCalledWith({
        allowedExtensions: ['pdf', 'docx', 'txt'],
        supportBatchUpload: true,
      })
    })

    it('should pass supportBatchUpload true by default', () => {
      render(<LocalFile allowedExtensions={['pdf']} />)

      expect(mockUseLocalFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({ supportBatchUpload: true }),
      )
    })

    it('should pass supportBatchUpload false when specified', () => {
      render(<LocalFile allowedExtensions={['pdf']} supportBatchUpload={false} />)

      expect(mockUseLocalFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({ supportBatchUpload: false }),
      )
    })
  })

  describe('props passed to UploadDropzone', () => {
    it('should pass all required props to UploadDropzone', () => {
      const selectHandle = vi.fn()
      const fileChangeHandle = vi.fn()

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        selectHandle,
        fileChangeHandle,
        supportTypesShowNames: 'PDF, DOCX',
        acceptTypes: ['.pdf', '.docx'],
        fileUploadConfig: {
          file_size_limit: 20,
          batch_count_limit: 10,
          file_upload_limit: 50,
        },
      })

      render(<LocalFile allowedExtensions={['pdf', 'docx']} supportBatchUpload={true} />)

      // Verify the dropzone is rendered with correct configuration
      const fileInput = document.getElementById('fileUploader')
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveAttribute('accept', '.pdf,.docx')
      expect(fileInput).toHaveAttribute('multiple')
    })
  })

  describe('props passed to FileListItem', () => {
    it('should pass correct props to file items', () => {
      const handlePreview = vi.fn()
      const removeFile = vi.fn()
      const mockFile = {
        name: 'document.pdf',
        size: 2048,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        handlePreview,
        removeFile,
        localFileList: [
          { fileID: 'test-id', file: mockFile, progress: 50 },
        ],
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      expect(screen.getByTestId('document-icon')).toHaveTextContent('document.pdf')
    })
  })

  describe('conditional rendering', () => {
    it('should show both dropzone and file list when files exist and hideUpload is false', () => {
      const mockFile = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        hideUpload: false,
        localFileList: [
          { fileID: 'file-1', file: mockFile, progress: -1 },
        ],
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      expect(document.getElementById('fileUploader')).toBeInTheDocument()
      expect(screen.getByTestId('document-icon')).toBeInTheDocument()
    })

    it('should show only file list when hideUpload is true', () => {
      const mockFile = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        hideUpload: true,
        localFileList: [
          { fileID: 'file-1', file: mockFile, progress: -1 },
        ],
      })

      render(<LocalFile allowedExtensions={['pdf']} />)

      expect(document.getElementById('fileUploader')).not.toBeInTheDocument()
      expect(screen.getByTestId('document-icon')).toBeInTheDocument()
    })
  })

  describe('file list container styling', () => {
    it('should apply correct container classes for file list', () => {
      const mockFile = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        localFileList: [
          { fileID: 'file-1', file: mockFile, progress: -1 },
        ],
      })

      const { container } = render(<LocalFile allowedExtensions={['pdf']} />)

      const fileListContainer = container.querySelector('.mt-1.flex.flex-col.gap-y-1')
      expect(fileListContainer).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('should handle empty allowedExtensions', () => {
      render(<LocalFile allowedExtensions={[]} />)

      expect(mockUseLocalFileUpload).toHaveBeenCalledWith({
        allowedExtensions: [],
        supportBatchUpload: true,
      })
    })

    it('should handle files with same fileID but different index', () => {
      const mockFile = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        localFileList: [
          { fileID: 'same-id', file: { ...mockFile, name: 'doc1.pdf' } as File, progress: -1 },
          { fileID: 'same-id', file: { ...mockFile, name: 'doc2.pdf' } as File, progress: -1 },
        ],
      })

      // Should render without key collision errors due to index in key
      render(<LocalFile allowedExtensions={['pdf']} />)

      const icons = screen.getAllByTestId('document-icon')
      expect(icons).toHaveLength(2)
    })
  })

  describe('component integration', () => {
    it('should render complete component tree', () => {
      const mockFile = {
        name: 'complete-test.pdf',
        size: 5 * 1024,
        type: 'application/pdf',
        lastModified: Date.now(),
      } as File

      mockUseLocalFileUpload.mockReturnValue({
        ...defaultHookReturn,
        hideUpload: false,
        localFileList: [
          { fileID: 'file-1', file: mockFile, progress: 50 },
        ],
        dragging: false,
      })

      const { container } = render(
        <LocalFile allowedExtensions={['pdf', 'docx']} supportBatchUpload={true} />,
      )

      // Main container
      expect(container.firstChild).toHaveClass('flex', 'flex-col')

      // Dropzone exists
      expect(document.getElementById('fileUploader')).toBeInTheDocument()

      // File list exists
      expect(screen.getByTestId('document-icon')).toBeInTheDocument()
    })
  })
})
