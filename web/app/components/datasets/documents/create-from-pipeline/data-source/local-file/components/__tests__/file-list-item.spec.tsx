import type { FileListItemProps } from '../file-list-item'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../../constants'
import FileListItem from '../file-list-item'

// Mock theme hook - can be changed per test
let mockTheme = 'light'
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

// Mock theme types
vi.mock('@/types/app', () => ({
  Theme: { dark: 'dark', light: 'light' },
}))

// Mock SimplePieChart with dynamic import handling
vi.mock('next/dynamic', () => ({
  default: () => {
    const DynamicComponent = ({ percentage, stroke, fill }: { percentage: number, stroke: string, fill: string }) => (
      <div data-testid="pie-chart" data-percentage={percentage} data-stroke={stroke} data-fill={fill}>
        Pie Chart:
        {' '}
        {percentage}
        %
      </div>
    )
    DynamicComponent.displayName = 'SimplePieChart'
    return DynamicComponent
  },
}))

// Mock DocumentFileIcon
vi.mock('@/app/components/datasets/common/document-file-icon', () => ({
  default: ({ name, extension, size }: { name: string, extension: string, size: string }) => (
    <div data-testid="document-icon" data-name={name} data-extension={extension} data-size={size}>
      Document Icon
    </div>
  ),
}))

describe('FileListItem', () => {
  const createMockFile = (overrides: Partial<File> = {}): File => ({
    name: 'test-document.pdf',
    size: 1024 * 100, // 100KB
    type: 'application/pdf',
    lastModified: Date.now(),
    ...overrides,
  } as File)

  const createMockFileItem = (overrides: Partial<FileItem> = {}): FileItem => ({
    fileID: 'file-123',
    file: createMockFile(overrides.file as Partial<File>),
    progress: PROGRESS_NOT_STARTED,
    ...overrides,
  })

  const defaultProps: FileListItemProps = {
    fileItem: createMockFileItem(),
    onPreview: vi.fn(),
    onRemove: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the file item container', () => {
      const { container } = render(<FileListItem {...defaultProps} />)

      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('flex', 'h-12', 'items-center', 'rounded-lg')
    })

    it('should render document icon with correct props', () => {
      render(<FileListItem {...defaultProps} />)

      const icon = screen.getByTestId('document-icon')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveAttribute('data-name', 'test-document.pdf')
      expect(icon).toHaveAttribute('data-extension', 'pdf')
      expect(icon).toHaveAttribute('data-size', 'lg')
    })

    it('should render file name', () => {
      render(<FileListItem {...defaultProps} />)

      expect(screen.getByText('test-document.pdf')).toBeInTheDocument()
    })

    it('should render file extension in uppercase via CSS class', () => {
      render(<FileListItem {...defaultProps} />)

      // Extension is rendered in lowercase but styled with uppercase CSS
      const extensionSpan = screen.getByText('pdf')
      expect(extensionSpan).toBeInTheDocument()
      expect(extensionSpan).toHaveClass('uppercase')
    })

    it('should render file size', () => {
      render(<FileListItem {...defaultProps} />)

      // 100KB (102400 bytes) formatted with formatFileSize
      expect(screen.getByText('100.00 KB')).toBeInTheDocument()
    })

    it('should render delete button', () => {
      const { container } = render(<FileListItem {...defaultProps} />)

      const deleteButton = container.querySelector('.cursor-pointer')
      expect(deleteButton).toBeInTheDocument()
    })
  })

  describe('progress states', () => {
    it('should show progress chart when uploading (0-99)', () => {
      const fileItem = createMockFileItem({ progress: 50 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const pieChart = screen.getByTestId('pie-chart')
      expect(pieChart).toBeInTheDocument()
      expect(pieChart).toHaveAttribute('data-percentage', '50')
    })

    it('should show progress chart at 0%', () => {
      const fileItem = createMockFileItem({ progress: 0 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const pieChart = screen.getByTestId('pie-chart')
      expect(pieChart).toHaveAttribute('data-percentage', '0')
    })

    it('should not show progress chart when complete (100)', () => {
      const fileItem = createMockFileItem({ progress: 100 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument()
    })

    it('should not show progress chart when not started (-1)', () => {
      const fileItem = createMockFileItem({ progress: PROGRESS_NOT_STARTED })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('should show error icon when progress is PROGRESS_ERROR', () => {
      const fileItem = createMockFileItem({ progress: PROGRESS_ERROR })
      const { container } = render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const errorIcon = container.querySelector('.text-text-destructive')
      expect(errorIcon).toBeInTheDocument()
    })

    it('should apply error styling to container', () => {
      const fileItem = createMockFileItem({ progress: PROGRESS_ERROR })
      const { container } = render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('border-state-destructive-border', 'bg-state-destructive-hover')
    })

    it('should not show error styling when not in error state', () => {
      const { container } = render(<FileListItem {...defaultProps} />)

      const item = container.firstChild as HTMLElement
      expect(item).not.toHaveClass('border-state-destructive-border')
    })
  })

  describe('theme handling', () => {
    it('should use correct chart color for light theme', () => {
      mockTheme = 'light'
      const fileItem = createMockFileItem({ progress: 50 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const pieChart = screen.getByTestId('pie-chart')
      expect(pieChart).toHaveAttribute('data-stroke', '#296dff')
      expect(pieChart).toHaveAttribute('data-fill', '#296dff')
    })

    it('should use correct chart color for dark theme', () => {
      mockTheme = 'dark'
      const fileItem = createMockFileItem({ progress: 50 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const pieChart = screen.getByTestId('pie-chart')
      expect(pieChart).toHaveAttribute('data-stroke', '#5289ff')
      expect(pieChart).toHaveAttribute('data-fill', '#5289ff')
    })
  })

  describe('event handlers', () => {
    it('should call onPreview when item is clicked', () => {
      const onPreview = vi.fn()
      const fileItem = createMockFileItem()
      render(<FileListItem {...defaultProps} fileItem={fileItem} onPreview={onPreview} />)

      const item = screen.getByText('test-document.pdf').closest('[class*="flex h-12"]')!
      fireEvent.click(item)

      expect(onPreview).toHaveBeenCalledTimes(1)
      expect(onPreview).toHaveBeenCalledWith(fileItem.file)
    })

    it('should call onRemove when delete button is clicked', () => {
      const onRemove = vi.fn()
      const fileItem = createMockFileItem()
      const { container } = render(<FileListItem {...defaultProps} fileItem={fileItem} onRemove={onRemove} />)

      const deleteButton = container.querySelector('.cursor-pointer')!
      fireEvent.click(deleteButton)

      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onRemove).toHaveBeenCalledWith('file-123')
    })

    it('should stop propagation when delete button is clicked', () => {
      const onPreview = vi.fn()
      const onRemove = vi.fn()
      const { container } = render(<FileListItem {...defaultProps} onPreview={onPreview} onRemove={onRemove} />)

      const deleteButton = container.querySelector('.cursor-pointer')!
      fireEvent.click(deleteButton)

      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onPreview).not.toHaveBeenCalled()
    })
  })

  describe('file type handling', () => {
    it('should handle files with multiple dots in name', () => {
      const fileItem = createMockFileItem({
        file: createMockFile({ name: 'my.document.file.docx' }),
      })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.getByText('my.document.file.docx')).toBeInTheDocument()
      // Extension is lowercase with uppercase CSS class
      expect(screen.getByText('docx')).toBeInTheDocument()
    })

    it('should handle files without extension', () => {
      const fileItem = createMockFileItem({
        file: createMockFile({ name: 'README' }),
      })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      // getFileType returns 'README' when there's no extension (last part after split)
      expect(screen.getAllByText('README')).toHaveLength(2) // filename and extension
    })

    it('should handle various file extensions', () => {
      const extensions = ['txt', 'md', 'json', 'csv', 'xlsx']

      extensions.forEach((ext) => {
        const fileItem = createMockFileItem({
          file: createMockFile({ name: `file.${ext}` }),
        })
        const { unmount } = render(<FileListItem {...defaultProps} fileItem={fileItem} />)
        // Extension is rendered in lowercase with uppercase CSS class
        expect(screen.getByText(ext)).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('file size display', () => {
    it('should display size in KB for small files', () => {
      const fileItem = createMockFileItem({
        file: createMockFile({ size: 5 * 1024 }), // 5KB
      })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.getByText('5.00 KB')).toBeInTheDocument()
    })

    it('should display size in MB for larger files', () => {
      const fileItem = createMockFileItem({
        file: createMockFile({ size: 5 * 1024 * 1024 }), // 5MB
      })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.getByText('5.00 MB')).toBeInTheDocument()
    })

    it('should display size at threshold (10KB)', () => {
      const fileItem = createMockFileItem({
        file: createMockFile({ size: 10 * 1024 }), // 10KB
      })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.getByText('10.00 KB')).toBeInTheDocument()
    })
  })

  describe('upload progress values', () => {
    it('should show chart at progress 1', () => {
      const fileItem = createMockFileItem({ progress: 1 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument()
    })

    it('should show chart at progress 99', () => {
      const fileItem = createMockFileItem({ progress: 99 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.getByTestId('pie-chart')).toHaveAttribute('data-percentage', '99')
    })

    it('should not show chart at progress 100', () => {
      const fileItem = createMockFileItem({ progress: 100 })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should have proper shadow styling', () => {
      const { container } = render(<FileListItem {...defaultProps} />)

      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('shadow-xs')
    })

    it('should have proper border styling', () => {
      const { container } = render(<FileListItem {...defaultProps} />)

      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('border', 'border-components-panel-border')
    })

    it('should truncate long file names', () => {
      const longFileName = 'this-is-a-very-long-file-name-that-should-be-truncated.pdf'
      const fileItem = createMockFileItem({
        file: createMockFile({ name: longFileName }),
      })
      render(<FileListItem {...defaultProps} fileItem={fileItem} />)

      const nameElement = screen.getByText(longFileName)
      expect(nameElement).toHaveClass('truncate')
    })
  })
})
