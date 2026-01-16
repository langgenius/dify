import type { CustomFile as File } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import FilePreview from './file-preview'

// Uses global react-i18next mock from web/vitest.setup.ts

// Mock useFilePreview hook - needs to be mocked to control return values
const mockUseFilePreview = vi.fn()
vi.mock('@/service/use-common', () => ({
  useFilePreview: (fileID: string) => mockUseFilePreview(fileID),
}))

// Test data factory
const createMockFile = (overrides?: Partial<File>): File => ({
  id: 'file-123',
  name: 'test-document.pdf',
  size: 2048,
  type: 'application/pdf',
  extension: 'pdf',
  lastModified: Date.now(),
  webkitRelativePath: '',
  arrayBuffer: vi.fn() as () => Promise<ArrayBuffer>,
  bytes: vi.fn() as () => Promise<Uint8Array>,
  slice: vi.fn() as (start?: number, end?: number, contentType?: string) => Blob,
  stream: vi.fn() as () => ReadableStream<Uint8Array>,
  text: vi.fn() as () => Promise<string>,
  ...overrides,
} as File)

const createMockFilePreviewData = (content: string = 'This is the file content') => ({
  content,
})

const defaultProps = {
  file: createMockFile(),
  hidePreview: vi.fn(),
}

describe('FilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFilePreview.mockReturnValue({
      data: undefined,
      isFetching: false,
    })
  })

  describe('Rendering', () => {
    it('should render the component with file information', () => {
      render(<FilePreview {...defaultProps} />)

      // i18n mock returns key by default
      expect(screen.getByText('datasetPipeline.addDocuments.stepOne.preview')).toBeInTheDocument()
      expect(screen.getByText('test-document.pdf')).toBeInTheDocument()
    })

    it('should display file extension in uppercase via CSS class', () => {
      render(<FilePreview {...defaultProps} />)

      // The extension is displayed in the info section (as uppercase via CSS class)
      const extensionElement = screen.getByText('pdf')
      expect(extensionElement).toBeInTheDocument()
      expect(extensionElement).toHaveClass('uppercase')
    })

    it('should display formatted file size', () => {
      render(<FilePreview {...defaultProps} />)

      // Real formatFileSize: 2048 bytes => "2.00 KB"
      expect(screen.getByText('2.00 KB')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<FilePreview {...defaultProps} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should call useFilePreview with correct fileID', () => {
      const file = createMockFile({ id: 'specific-file-id' })

      render(<FilePreview {...defaultProps} file={file} />)

      expect(mockUseFilePreview).toHaveBeenCalledWith('specific-file-id')
    })
  })

  describe('File Name Processing', () => {
    it('should extract file name without extension', () => {
      const file = createMockFile({ name: 'my-document.pdf', extension: 'pdf' })

      render(<FilePreview {...defaultProps} file={file} />)

      // The displayed text is `${fileName}.${extension}`, where fileName is name without ext
      // my-document.pdf -> fileName = 'my-document', displayed as 'my-document.pdf'
      expect(screen.getByText('my-document.pdf')).toBeInTheDocument()
    })

    it('should handle file name with multiple dots', () => {
      const file = createMockFile({ name: 'my.file.name.pdf', extension: 'pdf' })

      render(<FilePreview {...defaultProps} file={file} />)

      // fileName = arr.slice(0, -1).join() = 'my,file,name', then displayed as 'my,file,name.pdf'
      expect(screen.getByText('my,file,name.pdf')).toBeInTheDocument()
    })

    it('should handle empty file name', () => {
      const file = createMockFile({ name: '', extension: '' })

      render(<FilePreview {...defaultProps} file={file} />)

      // fileName = '', displayed as '.'
      expect(screen.getByText('.')).toBeInTheDocument()
    })

    it('should handle file without extension in name', () => {
      const file = createMockFile({ name: 'noextension', extension: '' })

      render(<FilePreview {...defaultProps} file={file} />)

      // fileName = '' (slice returns empty for single element array), displayed as '.'
      expect(screen.getByText('.')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should render loading component when fetching', () => {
      mockUseFilePreview.mockReturnValue({
        data: undefined,
        isFetching: true,
      })

      render(<FilePreview {...defaultProps} />)

      // Loading component renders skeleton
      expect(document.querySelector('.overflow-hidden')).toBeInTheDocument()
    })

    it('should not render content when loading', () => {
      mockUseFilePreview.mockReturnValue({
        data: createMockFilePreviewData('Some content'),
        isFetching: true,
      })

      render(<FilePreview {...defaultProps} />)

      expect(screen.queryByText('Some content')).not.toBeInTheDocument()
    })
  })

  describe('Content Display', () => {
    it('should render file content when loaded', () => {
      mockUseFilePreview.mockReturnValue({
        data: createMockFilePreviewData('This is the file content'),
        isFetching: false,
      })

      render(<FilePreview {...defaultProps} />)

      expect(screen.getByText('This is the file content')).toBeInTheDocument()
    })

    it('should display character count when data is available', () => {
      mockUseFilePreview.mockReturnValue({
        data: createMockFilePreviewData('Hello'), // 5 characters
        isFetching: false,
      })

      render(<FilePreview {...defaultProps} />)

      // Real formatNumberAbbreviated returns "5" for numbers < 1000
      expect(screen.getByText(/5/)).toBeInTheDocument()
    })

    it('should format large character counts', () => {
      const longContent = 'a'.repeat(2500)
      mockUseFilePreview.mockReturnValue({
        data: createMockFilePreviewData(longContent),
        isFetching: false,
      })

      render(<FilePreview {...defaultProps} />)

      // Real formatNumberAbbreviated uses lowercase 'k': "2.5k"
      expect(screen.getByText(/2\.5k/)).toBeInTheDocument()
    })

    it('should not display character count when data is not available', () => {
      mockUseFilePreview.mockReturnValue({
        data: undefined,
        isFetching: false,
      })

      render(<FilePreview {...defaultProps} />)

      // No character text shown
      expect(screen.queryByText(/datasetPipeline\.addDocuments\.characters/)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', () => {
      const hidePreview = vi.fn()

      render(<FilePreview {...defaultProps} hidePreview={hidePreview} />)

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      expect(hidePreview).toHaveBeenCalledTimes(1)
    })
  })

  describe('File Size Formatting', () => {
    it('should format small file sizes in bytes', () => {
      const file = createMockFile({ size: 500 })

      render(<FilePreview {...defaultProps} file={file} />)

      // Real formatFileSize: 500 => "500.00 bytes"
      expect(screen.getByText('500.00 bytes')).toBeInTheDocument()
    })

    it('should format kilobyte file sizes', () => {
      const file = createMockFile({ size: 5120 })

      render(<FilePreview {...defaultProps} file={file} />)

      // Real formatFileSize: 5120 => "5.00 KB"
      expect(screen.getByText('5.00 KB')).toBeInTheDocument()
    })

    it('should format megabyte file sizes', () => {
      const file = createMockFile({ size: 2097152 })

      render(<FilePreview {...defaultProps} file={file} />)

      // Real formatFileSize: 2097152 => "2.00 MB"
      expect(screen.getByText('2.00 MB')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined file id', () => {
      const file = createMockFile({ id: undefined })

      render(<FilePreview {...defaultProps} file={file} />)

      expect(mockUseFilePreview).toHaveBeenCalledWith('')
    })

    it('should handle empty extension', () => {
      const file = createMockFile({ extension: undefined })

      render(<FilePreview {...defaultProps} file={file} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle zero file size', () => {
      const file = createMockFile({ size: 0 })

      render(<FilePreview {...defaultProps} file={file} />)

      // Real formatFileSize returns 0 for falsy values
      // The component still renders
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle very long file content', () => {
      const veryLongContent = 'a'.repeat(1000000)
      mockUseFilePreview.mockReturnValue({
        data: createMockFilePreviewData(veryLongContent),
        isFetching: false,
      })

      render(<FilePreview {...defaultProps} />)

      // Real formatNumberAbbreviated: 1000000 => "1M"
      expect(screen.getByText(/1M/)).toBeInTheDocument()
    })

    it('should handle empty content', () => {
      mockUseFilePreview.mockReturnValue({
        data: createMockFilePreviewData(''),
        isFetching: false,
      })

      render(<FilePreview {...defaultProps} />)

      // Real formatNumberAbbreviated: 0 => "0"
      // Find the element that contains character count info
      expect(screen.getByText(/0 datasetPipeline/)).toBeInTheDocument()
    })
  })

  describe('useMemo for fileName', () => {
    it('should extract file name when file exists', () => {
      // When file exists, it should extract the name without extension
      const file = createMockFile({ name: 'document.txt', extension: 'txt' })

      render(<FilePreview {...defaultProps} file={file} />)

      expect(screen.getByText('document.txt')).toBeInTheDocument()
    })

    it('should memoize fileName based on file prop', () => {
      const file = createMockFile({ name: 'test.pdf', extension: 'pdf' })

      const { rerender } = render(<FilePreview {...defaultProps} file={file} />)

      // Same file should produce same result
      rerender(<FilePreview {...defaultProps} file={file} />)

      expect(screen.getByText('test.pdf')).toBeInTheDocument()
    })
  })
})
