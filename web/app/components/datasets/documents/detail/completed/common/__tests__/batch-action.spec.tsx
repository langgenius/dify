import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchAction from '../batch-action'

describe('BatchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    selectedIds: ['1', '2', '3'],
    onBatchEnable: vi.fn(),
    onBatchDisable: vi.fn(),
    onBatchDelete: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<BatchAction {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should display selected count', () => {
      render(<BatchAction {...defaultProps} />)

      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('should render enable button', () => {
      render(<BatchAction {...defaultProps} />)

      expect(screen.getByText(/batchAction\.enable/i)).toBeInTheDocument()
    })

    it('should render disable button', () => {
      render(<BatchAction {...defaultProps} />)

      expect(screen.getByText(/batchAction\.disable/i)).toBeInTheDocument()
    })

    it('should render delete button', () => {
      render(<BatchAction {...defaultProps} />)

      expect(screen.getByText(/batchAction\.delete/i)).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<BatchAction {...defaultProps} />)

      expect(screen.getByText(/batchAction\.cancel/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onBatchEnable when enable button is clicked', () => {
      const mockOnBatchEnable = vi.fn()
      render(<BatchAction {...defaultProps} onBatchEnable={mockOnBatchEnable} />)

      fireEvent.click(screen.getByText(/batchAction\.enable/i))

      expect(mockOnBatchEnable).toHaveBeenCalledTimes(1)
    })

    it('should call onBatchDisable when disable button is clicked', () => {
      const mockOnBatchDisable = vi.fn()
      render(<BatchAction {...defaultProps} onBatchDisable={mockOnBatchDisable} />)

      fireEvent.click(screen.getByText(/batchAction\.disable/i))

      expect(mockOnBatchDisable).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when cancel button is clicked', () => {
      const mockOnCancel = vi.fn()
      render(<BatchAction {...defaultProps} onCancel={mockOnCancel} />)

      fireEvent.click(screen.getByText(/batchAction\.cancel/i))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should show delete confirmation dialog when delete button is clicked', () => {
      render(<BatchAction {...defaultProps} />)

      fireEvent.click(screen.getByText(/batchAction\.delete/i))

      // Assert - Confirm dialog should appear
      expect(screen.getByText(/list\.delete\.title/i)).toBeInTheDocument()
    })

    it('should call onBatchDelete when confirm is clicked in delete dialog', async () => {
      const mockOnBatchDelete = vi.fn().mockResolvedValue(undefined)
      render(<BatchAction {...defaultProps} onBatchDelete={mockOnBatchDelete} />)

      // Act - open delete dialog
      fireEvent.click(screen.getByText(/batchAction\.delete/i))

      // Act - click confirm
      const confirmButton = screen.getByText(/operation\.sure/i)
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockOnBatchDelete).toHaveBeenCalledTimes(1)
      })
    })
  })

  // Optional props tests
  describe('Optional Props', () => {
    it('should render download button when onBatchDownload is provided', () => {
      render(<BatchAction {...defaultProps} onBatchDownload={vi.fn()} />)

      expect(screen.getByText(/batchAction\.download/i)).toBeInTheDocument()
    })

    it('should not render download button when onBatchDownload is not provided', () => {
      render(<BatchAction {...defaultProps} />)

      expect(screen.queryByText(/batchAction\.download/i)).not.toBeInTheDocument()
    })

    it('should render archive button when onArchive is provided', () => {
      render(<BatchAction {...defaultProps} onArchive={vi.fn()} />)

      expect(screen.getByText(/batchAction\.archive/i)).toBeInTheDocument()
    })

    it('should render metadata button when onEditMetadata is provided', () => {
      render(<BatchAction {...defaultProps} onEditMetadata={vi.fn()} />)

      expect(screen.getByText(/metadata\.metadata/i)).toBeInTheDocument()
    })

    it('should render re-index button when onBatchReIndex is provided', () => {
      render(<BatchAction {...defaultProps} onBatchReIndex={vi.fn()} />)

      expect(screen.getByText(/batchAction\.reIndex/i)).toBeInTheDocument()
    })

    it('should call onBatchDownload when download button is clicked', () => {
      const mockOnBatchDownload = vi.fn()
      render(<BatchAction {...defaultProps} onBatchDownload={mockOnBatchDownload} />)

      fireEvent.click(screen.getByText(/batchAction\.download/i))

      expect(mockOnBatchDownload).toHaveBeenCalledTimes(1)
    })

    it('should call onArchive when archive button is clicked', () => {
      const mockOnArchive = vi.fn()
      render(<BatchAction {...defaultProps} onArchive={mockOnArchive} />)

      fireEvent.click(screen.getByText(/batchAction\.archive/i))

      expect(mockOnArchive).toHaveBeenCalledTimes(1)
    })

    it('should call onEditMetadata when metadata button is clicked', () => {
      const mockOnEditMetadata = vi.fn()
      render(<BatchAction {...defaultProps} onEditMetadata={mockOnEditMetadata} />)

      fireEvent.click(screen.getByText(/metadata\.metadata/i))

      expect(mockOnEditMetadata).toHaveBeenCalledTimes(1)
    })

    it('should call onBatchReIndex when re-index button is clicked', () => {
      const mockOnBatchReIndex = vi.fn()
      render(<BatchAction {...defaultProps} onBatchReIndex={mockOnBatchReIndex} />)

      fireEvent.click(screen.getByText(/batchAction\.reIndex/i))

      expect(mockOnBatchReIndex).toHaveBeenCalledTimes(1)
    })

    it('should apply custom className', () => {
      const { container } = render(<BatchAction {...defaultProps} className="custom-class" />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  // Selected count display tests
  describe('Selected Count', () => {
    it('should display correct count for single selection', () => {
      render(<BatchAction {...defaultProps} selectedIds={['1']} />)

      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should display correct count for multiple selections', () => {
      render(<BatchAction {...defaultProps} selectedIds={['1', '2', '3', '4', '5']} />)

      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<BatchAction {...defaultProps} />)

      rerender(<BatchAction {...defaultProps} selectedIds={['1', '2']} />)

      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should handle empty selectedIds array', () => {
      render(<BatchAction {...defaultProps} selectedIds={[]} />)

      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })
})
