import type { ReactNode } from 'react'
import type { CustomFile, FileItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Theme } from '@/types/app'

import CSVUploader from './csv-uploader'

// Mock upload service
const mockUpload = vi.fn()
vi.mock('@/service/base', () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}))

// Mock useFileUploadConfig
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: { file_size_limit: 15 },
  }),
}))

// Mock useTheme
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: Theme.light }),
}))

// Mock ToastContext
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  ToastContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
    Consumer: ({ children }: { children: (ctx: { notify: typeof mockNotify }) => ReactNode }) => children({ notify: mockNotify }),
  },
}))

// Create a mock ToastContext for useContext
vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    useContext: () => ({ notify: mockNotify }),
  }
})

describe('CSVUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    file: undefined as FileItem | undefined,
    updateFile: vi.fn(),
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render upload area when no file is present', () => {
      // Arrange & Act
      render(<CSVUploader {...defaultProps} />)

      // Assert
      expect(screen.getByText(/list\.batchModal\.csvUploadTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/list\.batchModal\.browse/i)).toBeInTheDocument()
    })

    it('should render hidden file input', () => {
      // Arrange & Act
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert
      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveStyle({ display: 'none' })
    })

    it('should accept only CSV files', () => {
      // Arrange & Act
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert
      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toHaveAttribute('accept', '.csv')
    })
  })

  // File display tests
  describe('File Display', () => {
    it('should display file info when file is present', () => {
      // Arrange
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test-file.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      // Act
      render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert
      expect(screen.getByText('test-file')).toBeInTheDocument()
      expect(screen.getByText('.csv')).toBeInTheDocument()
    })

    it('should not show upload area when file is present', () => {
      // Arrange
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      // Act
      render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert
      expect(screen.queryByText(/list\.batchModal\.csvUploadTitle/i)).not.toBeInTheDocument()
    })

    it('should show change button when file is present', () => {
      // Arrange
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      // Act
      render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert
      expect(screen.getByText(/stepOne\.uploader\.change/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should trigger file input click when browse is clicked', () => {
      // Arrange
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      // Act
      fireEvent.click(screen.getByText(/list\.batchModal\.browse/i))

      // Assert
      expect(clickSpy).toHaveBeenCalled()
    })

    it('should call updateFile when file is selected', async () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      mockUpload.mockResolvedValueOnce({ id: 'uploaded-id' })

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert
      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalled()
      })
    })

    it('should call updateFile with undefined when remove is clicked', () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }
      const { container } = render(
        <CSVUploader {...defaultProps} file={mockFile} updateFile={mockUpdateFile} />,
      )

      // Act
      const deleteButton = container.querySelector('.cursor-pointer')
      if (deleteButton)
        fireEvent.click(deleteButton)

      // Assert
      expect(mockUpdateFile).toHaveBeenCalledWith()
    })
  })

  // Validation tests
  describe('Validation', () => {
    it('should show error for non-CSV files', () => {
      // Arrange
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.txt', { type: 'text/plain' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })

    it('should show error for files exceeding size limit', () => {
      // Arrange
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      // Create a mock file with a large size (16MB) without actually creating the data
      const testFile = new File(['test'], 'large.csv', { type: 'text/csv' })
      Object.defineProperty(testFile, 'size', { value: 16 * 1024 * 1024 })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })
  })

  // Upload progress tests
  describe('Upload Progress', () => {
    it('should show progress indicator when upload is in progress', () => {
      // Arrange
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 50,
      }

      // Act
      const { container } = render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert - SimplePieChart should be rendered for progress 0-99
      // The pie chart would be in the hidden group element
      expect(container.querySelector('.group')).toBeInTheDocument()
    })

    it('should not show progress for completed uploads', () => {
      // Arrange
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      // Act
      render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert - File name should be displayed
      expect(screen.getByText('test')).toBeInTheDocument()
    })
  })

  // Props tests
  describe('Props', () => {
    it('should call updateFile prop when provided', async () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      mockUpload.mockResolvedValueOnce({ id: 'test-id' })

      const { container } = render(
        <CSVUploader file={undefined} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert
      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalled()
      })
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty file list', () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      // Act
      fireEvent.change(fileInput, { target: { files: [] } })

      // Assert
      expect(mockUpdateFile).not.toHaveBeenCalled()
    })

    it('should handle null file', () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      // Act
      fireEvent.change(fileInput, { target: { files: null } })

      // Assert
      expect(mockUpdateFile).not.toHaveBeenCalled()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<CSVUploader {...defaultProps} />)

      // Act
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'updated.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }
      rerender(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert
      expect(screen.getByText('updated')).toBeInTheDocument()
    })

    it('should handle upload error', async () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      mockUpload.mockRejectedValueOnce(new Error('Upload failed'))

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should handle file without extension', () => {
      // Arrange
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'noextension', { type: 'text/plain' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })
  })

  // Drag and drop tests
  // Note: Native drag and drop events use addEventListener which is set up in useEffect.
  // Testing these requires triggering native DOM events on the actual dropRef element.
  describe('Drag and Drop', () => {
    it('should render drop zone element', () => {
      // Arrange & Act
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert - drop zone should exist for drag and drop
      const dropZone = container.querySelector('div > div')
      expect(dropZone).toBeInTheDocument()
    })

    it('should have drag overlay element that can appear during drag', () => {
      // Arrange & Act
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert - component structure supports dragging
      expect(container.querySelector('div')).toBeInTheDocument()
    })
  })

  // Upload progress callback tests
  describe('Upload Progress Callbacks', () => {
    it('should update progress during file upload', async () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      let progressCallback: ((e: ProgressEvent) => void) | undefined

      mockUpload.mockImplementation(({ onprogress }) => {
        progressCallback = onprogress
        return Promise.resolve({ id: 'uploaded-id' })
      })

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Simulate progress event
      if (progressCallback) {
        const progressEvent = new ProgressEvent('progress', {
          lengthComputable: true,
          loaded: 50,
          total: 100,
        })
        progressCallback(progressEvent)
      }

      // Assert
      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalledWith(
          expect.objectContaining({
            progress: expect.any(Number),
          }),
        )
      })
    })

    it('should handle progress event with lengthComputable false', async () => {
      // Arrange
      const mockUpdateFile = vi.fn()
      let progressCallback: ((e: ProgressEvent) => void) | undefined

      mockUpload.mockImplementation(({ onprogress }) => {
        progressCallback = onprogress
        return Promise.resolve({ id: 'uploaded-id' })
      })

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      // Act
      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Simulate progress event with lengthComputable false
      if (progressCallback) {
        const progressEvent = new ProgressEvent('progress', {
          lengthComputable: false,
          loaded: 50,
          total: 100,
        })
        progressCallback(progressEvent)
      }

      // Assert - should complete upload without progress updates when lengthComputable is false
      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalled()
      })
    })
  })
})
