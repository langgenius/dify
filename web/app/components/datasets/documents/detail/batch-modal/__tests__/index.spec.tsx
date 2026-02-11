import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import BatchModal from '../index'

vi.mock('../csv-downloader', () => ({
  default: ({ docForm }: { docForm: ChunkingMode }) => (
    <div data-testid="csv-downloader" data-doc-form={docForm}>
      CSV Downloader
    </div>
  ),
}))

vi.mock('../csv-uploader', () => ({
  default: ({ file, updateFile }: { file: { file?: { id: string } } | undefined, updateFile: (file: { file: { id: string } } | undefined) => void }) => (
    <div data-testid="csv-uploader">
      <button
        data-testid="upload-btn"
        onClick={() => updateFile({ file: { id: 'test-file-id' } })}
      >
        Upload
      </button>
      <button
        data-testid="clear-btn"
        onClick={() => updateFile(undefined)}
      >
        Clear
      </button>
      {file && <span data-testid="file-info">{file.file?.id}</span>}
    </div>
  ),
}))

describe('BatchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    isShow: true,
    docForm: ChunkingMode.text,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing when isShow is true', () => {
      render(<BatchModal {...defaultProps} />)

      expect(screen.getByText(/list\.batchModal\.title/i)).toBeInTheDocument()
    })

    it('should not render content when isShow is false', () => {
      render(<BatchModal {...defaultProps} isShow={false} />)

      // Assert - Modal is closed
      expect(screen.queryByText(/list\.batchModal\.title/i)).not.toBeInTheDocument()
    })

    it('should render CSVDownloader component', () => {
      render(<BatchModal {...defaultProps} />)

      expect(screen.getByTestId('csv-downloader')).toBeInTheDocument()
    })

    it('should render CSVUploader component', () => {
      render(<BatchModal {...defaultProps} />)

      expect(screen.getByTestId('csv-uploader')).toBeInTheDocument()
    })

    it('should render cancel and run buttons', () => {
      render(<BatchModal {...defaultProps} />)

      expect(screen.getByText(/list\.batchModal\.cancel/i)).toBeInTheDocument()
      expect(screen.getByText(/list\.batchModal\.run/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const mockOnCancel = vi.fn()
      render(<BatchModal {...defaultProps} onCancel={mockOnCancel} />)

      fireEvent.click(screen.getByText(/list\.batchModal\.cancel/i))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should disable run button when no file is uploaded', () => {
      render(<BatchModal {...defaultProps} />)

      const runButton = screen.getByText(/list\.batchModal\.run/i).closest('button')
      expect(runButton).toBeDisabled()
    })

    it('should enable run button after file is uploaded', async () => {
      render(<BatchModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('upload-btn'))

      await waitFor(() => {
        const runButton = screen.getByText(/list\.batchModal\.run/i).closest('button')
        expect(runButton).not.toBeDisabled()
      })
    })

    it('should call onConfirm with file when run button is clicked', async () => {
      const mockOnConfirm = vi.fn()
      const mockOnCancel = vi.fn()
      render(<BatchModal {...defaultProps} onConfirm={mockOnConfirm} onCancel={mockOnCancel} />)

      // Act - upload file first
      fireEvent.click(screen.getByTestId('upload-btn'))

      await waitFor(() => {
        const runButton = screen.getByText(/list\.batchModal\.run/i).closest('button')
        expect(runButton).not.toBeDisabled()
      })

      // Act - click run
      fireEvent.click(screen.getByText(/list\.batchModal\.run/i))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
      expect(mockOnConfirm).toHaveBeenCalledWith({ file: { id: 'test-file-id' } })
    })
  })

  describe('Props', () => {
    it('should pass docForm to CSVDownloader', () => {
      render(<BatchModal {...defaultProps} docForm={ChunkingMode.qa} />)

      expect(screen.getByTestId('csv-downloader').getAttribute('data-doc-form')).toBe(ChunkingMode.qa)
    })
  })

  // State reset tests
  describe('State Reset', () => {
    it('should reset file when modal is closed and reopened', async () => {
      const { rerender } = render(<BatchModal {...defaultProps} />)

      // Upload a file
      fireEvent.click(screen.getByTestId('upload-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('file-info')).toBeInTheDocument()
      })

      rerender(<BatchModal {...defaultProps} isShow={false} />)

      // Reopen modal
      rerender(<BatchModal {...defaultProps} isShow={true} />)

      // Assert - file should be cleared
      expect(screen.queryByTestId('file-info')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should not call onConfirm when no file is present', () => {
      const mockOnConfirm = vi.fn()
      render(<BatchModal {...defaultProps} onConfirm={mockOnConfirm} />)

      // Act - try to click run (should be disabled)
      const runButton = screen.getByText(/list\.batchModal\.run/i).closest('button')
      if (runButton)
        fireEvent.click(runButton)

      expect(mockOnConfirm).not.toHaveBeenCalled()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<BatchModal {...defaultProps} />)

      rerender(<BatchModal {...defaultProps} docForm={ChunkingMode.qa} />)

      expect(screen.getByText(/list\.batchModal\.title/i)).toBeInTheDocument()
    })

    it('should handle file cleared after upload', async () => {
      const mockOnConfirm = vi.fn()
      render(<BatchModal {...defaultProps} onConfirm={mockOnConfirm} />)

      // Upload a file first
      fireEvent.click(screen.getByTestId('upload-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('file-info')).toBeInTheDocument()
      })

      // Clear the file
      fireEvent.click(screen.getByTestId('clear-btn'))

      // Assert - run button should be disabled again
      const runButton = screen.getByText(/list\.batchModal\.run/i).closest('button')
      expect(runButton).toBeDisabled()
    })
  })
})
