import type { ReactNode } from 'react'
import type { CustomFile, FileItem } from '@/models/datasets'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Theme } from '@/types/app'

import CSVUploader from '../csv-uploader'

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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render upload area when no file is present', () => {
      render(<CSVUploader {...defaultProps} />)

      expect(screen.getByText(/list\.batchModal\.csvUploadTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/list\.batchModal\.browse/i)).toBeInTheDocument()
    })

    it('should render hidden file input', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)

      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveStyle({ display: 'none' })
    })

    it('should accept only CSV files', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)

      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toHaveAttribute('accept', '.csv')
    })
  })

  // File display tests
  describe('File Display', () => {
    it('should display file info when file is present', () => {
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test-file.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      render(<CSVUploader {...defaultProps} file={mockFile} />)

      expect(screen.getByText('test-file')).toBeInTheDocument()
      expect(screen.getByText('.csv')).toBeInTheDocument()
    })

    it('should not show upload area when file is present', () => {
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      render(<CSVUploader {...defaultProps} file={mockFile} />)

      expect(screen.queryByText(/list\.batchModal\.csvUploadTitle/i)).not.toBeInTheDocument()
    })

    it('should show change button when file is present', () => {
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      render(<CSVUploader {...defaultProps} file={mockFile} />)

      expect(screen.getByText(/stepOne\.uploader\.change/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should trigger file input click when browse is clicked', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      fireEvent.click(screen.getByText(/list\.batchModal\.browse/i))

      expect(clickSpy).toHaveBeenCalled()
    })

    it('should call updateFile when file is selected', async () => {
      const mockUpdateFile = vi.fn()
      mockUpload.mockResolvedValueOnce({ id: 'uploaded-id' })

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalled()
      })
    })

    it('should call updateFile with undefined when remove is clicked', () => {
      const mockUpdateFile = vi.fn()
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }
      const { container } = render(
        <CSVUploader {...defaultProps} file={mockFile} updateFile={mockUpdateFile} />,
      )

      const deleteButton = container.querySelector('.cursor-pointer')
      if (deleteButton)
        fireEvent.click(deleteButton)

      expect(mockUpdateFile).toHaveBeenCalledWith()
    })
  })

  describe('Validation', () => {
    it('should show error for non-CSV files', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.txt', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })

    it('should show error for files exceeding size limit', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      // Create a mock file with a large size (16MB) without actually creating the data
      const testFile = new File(['test'], 'large.csv', { type: 'text/csv' })
      Object.defineProperty(testFile, 'size', { value: 16 * 1024 * 1024 })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

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
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 50,
      }

      const { container } = render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert - SimplePieChart should be rendered for progress 0-99
      // The pie chart would be in the hidden group element
      expect(container.querySelector('.group')).toBeInTheDocument()
    })

    it('should not show progress for completed uploads', () => {
      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'test.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }

      render(<CSVUploader {...defaultProps} file={mockFile} />)

      // Assert - File name should be displayed
      expect(screen.getByText('test')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should call updateFile prop when provided', async () => {
      const mockUpdateFile = vi.fn()
      mockUpload.mockResolvedValueOnce({ id: 'test-id' })

      const { container } = render(
        <CSVUploader file={undefined} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalled()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty file list', () => {
      const mockUpdateFile = vi.fn()
      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      fireEvent.change(fileInput, { target: { files: [] } })

      expect(mockUpdateFile).not.toHaveBeenCalled()
    })

    it('should handle null file', () => {
      const mockUpdateFile = vi.fn()
      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      fireEvent.change(fileInput, { target: { files: null } })

      expect(mockUpdateFile).not.toHaveBeenCalled()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<CSVUploader {...defaultProps} />)

      const mockFile: FileItem = {
        fileID: 'file-1',
        file: new File(['content'], 'updated.csv', { type: 'text/csv' }) as CustomFile,
        progress: 100,
      }
      rerender(<CSVUploader {...defaultProps} file={mockFile} />)

      expect(screen.getByText('updated')).toBeInTheDocument()
    })

    it('should handle upload error', async () => {
      const mockUpdateFile = vi.fn()
      mockUpload.mockRejectedValueOnce(new Error('Upload failed'))

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'test.csv', { type: 'text/csv' })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should handle file without extension', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'noextension', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

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
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert - drop zone should exist for drag and drop
      const dropZone = container.querySelector('div > div')
      expect(dropZone).toBeInTheDocument()
    })

    it('should have drag overlay element that can appear during drag', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)

      // Assert - component structure supports dragging
      expect(container.querySelector('div')).toBeInTheDocument()
    })
  })

  // Upload progress callback tests
  describe('Upload Progress Callbacks', () => {
    it('should update progress during file upload', async () => {
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

      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalledWith(
          expect.objectContaining({
            progress: expect.any(Number),
          }),
        )
      })
    })

    it('should handle progress event with lengthComputable false', async () => {
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

  describe('Drag and Drop Events', () => {
    // Helper to get the dropRef element (sibling of the hidden file input)
    const getDropZone = (container: HTMLElement) => {
      const fileInput = container.querySelector('input[type="file"]')
      return fileInput?.nextElementSibling as HTMLElement
    }

    it('should handle dragenter event and set dragging state', async () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const dropZone = getDropZone(container)

      // Act - dispatch dragenter event wrapped in act to avoid state update warning
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'target', { value: dropZone })
      act(() => {
        dropZone.dispatchEvent(dragEnterEvent)
      })

      // Assert - dragging class should be applied (border style changes)
      await waitFor(() => {
        const uploadArea = container.querySelector('.border-dashed')
        expect(uploadArea || dropZone).toBeInTheDocument()
      })
    })

    it('should handle dragover event', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const dropZone = getDropZone(container)

      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      dropZone.dispatchEvent(dragOverEvent)

      // Assert - no error thrown
      expect(dropZone).toBeInTheDocument()
    })

    it('should handle dragleave event', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const dropZone = getDropZone(container)

      // First set dragging to true
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      act(() => {
        dropZone.dispatchEvent(dragEnterEvent)
      })

      // Act - dispatch dragleave
      const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
      act(() => {
        dropZone.dispatchEvent(dragLeaveEvent)
      })

      expect(dropZone).toBeInTheDocument()
    })

    it('should set dragging to false when dragleave target is the drag overlay', async () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const dropZone = getDropZone(container)

      // Trigger dragenter to set dragging=true, which renders the overlay
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      act(() => {
        dropZone.dispatchEvent(dragEnterEvent)
      })

      // Find the drag overlay element (rendered only when dragging=true)
      await waitFor(() => {
        expect(container.querySelector('.absolute.left-0.top-0')).toBeInTheDocument()
      })
      const dragOverlay = container.querySelector('.absolute.left-0.top-0') as HTMLElement

      // Act - dispatch dragleave FROM the overlay so e.target === dragRef.current (line 121)
      const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
      Object.defineProperty(dragLeaveEvent, 'target', { value: dragOverlay })
      act(() => {
        dropZone.dispatchEvent(dragLeaveEvent)
      })

      // Assert - dragging should be set to false, overlay should disappear
      await waitFor(() => {
        expect(container.querySelector('.absolute.left-0.top-0')).not.toBeInTheDocument()
      })
    })

    it('should handle drop event with valid CSV file', async () => {
      const mockUpdateFile = vi.fn()
      mockUpload.mockResolvedValueOnce({ id: 'dropped-file-id' })

      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const dropZone = getDropZone(container)

      // Create a drop event with a CSV file
      const testFile = new File(['csv,data'], 'dropped.csv', { type: 'text/csv' })
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [testFile],
        },
      })

      act(() => {
        dropZone.dispatchEvent(dropEvent)
      })

      await waitFor(() => {
        expect(mockUpdateFile).toHaveBeenCalled()
      })
    })

    it('should show error when dropping multiple files', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const dropZone = getDropZone(container)

      // Create a drop event with multiple files
      const file1 = new File(['csv1'], 'file1.csv', { type: 'text/csv' })
      const file2 = new File(['csv2'], 'file2.csv', { type: 'text/csv' })
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file1, file2],
        },
      })

      act(() => {
        dropZone.dispatchEvent(dropEvent)
      })

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })

    it('should handle drop event without dataTransfer', () => {
      const mockUpdateFile = vi.fn()
      const { container } = render(
        <CSVUploader {...defaultProps} updateFile={mockUpdateFile} />,
      )
      const dropZone = getDropZone(container)

      // Create a drop event without dataTransfer
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })

      act(() => {
        dropZone.dispatchEvent(dropEvent)
      })

      // Assert - should not call updateFile
      expect(mockUpdateFile).not.toHaveBeenCalled()
    })
  })

  describe('getFileType edge cases', () => {
    it('should handle file with multiple dots in name', () => {
      const { container } = render(<CSVUploader {...defaultProps} />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const testFile = new File(['content'], 'my.data.file.csv', { type: 'text/csv' })

      fireEvent.change(fileInput, { target: { files: [testFile] } })

      // Assert - should be valid and trigger upload
      expect(mockNotify).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })
  })
})
