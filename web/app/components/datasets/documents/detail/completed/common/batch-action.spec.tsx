import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchAction from './batch-action'

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

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<BatchAction {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should display selected count', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} />)

      // Assert
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('should render enable button', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} />)

      // Assert
      expect(screen.getByText(/batchAction\.enable/i)).toBeInTheDocument()
    })

    it('should render disable button', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} />)

      // Assert
      expect(screen.getByText(/batchAction\.disable/i)).toBeInTheDocument()
    })

    it('should render delete button', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} />)

      // Assert
      expect(screen.getByText(/batchAction\.delete/i)).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} />)

      // Assert
      expect(screen.getByText(/batchAction\.cancel/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onBatchEnable when enable button is clicked', () => {
      // Arrange
      const mockOnBatchEnable = vi.fn()
      render(<BatchAction {...defaultProps} onBatchEnable={mockOnBatchEnable} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.enable/i))

      // Assert
      expect(mockOnBatchEnable).toHaveBeenCalledTimes(1)
    })

    it('should call onBatchDisable when disable button is clicked', () => {
      // Arrange
      const mockOnBatchDisable = vi.fn()
      render(<BatchAction {...defaultProps} onBatchDisable={mockOnBatchDisable} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.disable/i))

      // Assert
      expect(mockOnBatchDisable).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when cancel button is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      render(<BatchAction {...defaultProps} onCancel={mockOnCancel} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.cancel/i))

      // Assert
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should show delete confirmation dialog when delete button is clicked', () => {
      // Arrange
      render(<BatchAction {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.delete/i))

      // Assert - Confirm dialog should appear
      expect(screen.getByText(/list\.delete\.title/i)).toBeInTheDocument()
    })

    it('should call onBatchDelete when confirm is clicked in delete dialog', async () => {
      // Arrange
      const mockOnBatchDelete = vi.fn().mockResolvedValue(undefined)
      render(<BatchAction {...defaultProps} onBatchDelete={mockOnBatchDelete} />)

      // Act - open delete dialog
      fireEvent.click(screen.getByText(/batchAction\.delete/i))

      // Act - click confirm
      const confirmButton = screen.getByText(/operation\.sure/i)
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockOnBatchDelete).toHaveBeenCalledTimes(1)
      })
    })
  })

  // Optional props tests
  describe('Optional Props', () => {
    it('should render download button when onBatchDownload is provided', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} onBatchDownload={vi.fn()} />)

      // Assert
      expect(screen.getByText(/batchAction\.download/i)).toBeInTheDocument()
    })

    it('should not render download button when onBatchDownload is not provided', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} />)

      // Assert
      expect(screen.queryByText(/batchAction\.download/i)).not.toBeInTheDocument()
    })

    it('should render archive button when onArchive is provided', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} onArchive={vi.fn()} />)

      // Assert
      expect(screen.getByText(/batchAction\.archive/i)).toBeInTheDocument()
    })

    it('should render metadata button when onEditMetadata is provided', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} onEditMetadata={vi.fn()} />)

      // Assert
      expect(screen.getByText(/metadata\.metadata/i)).toBeInTheDocument()
    })

    it('should render re-index button when onBatchReIndex is provided', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} onBatchReIndex={vi.fn()} />)

      // Assert
      expect(screen.getByText(/batchAction\.reIndex/i)).toBeInTheDocument()
    })

    it('should call onBatchDownload when download button is clicked', () => {
      // Arrange
      const mockOnBatchDownload = vi.fn()
      render(<BatchAction {...defaultProps} onBatchDownload={mockOnBatchDownload} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.download/i))

      // Assert
      expect(mockOnBatchDownload).toHaveBeenCalledTimes(1)
    })

    it('should call onArchive when archive button is clicked', () => {
      // Arrange
      const mockOnArchive = vi.fn()
      render(<BatchAction {...defaultProps} onArchive={mockOnArchive} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.archive/i))

      // Assert
      expect(mockOnArchive).toHaveBeenCalledTimes(1)
    })

    it('should call onEditMetadata when metadata button is clicked', () => {
      // Arrange
      const mockOnEditMetadata = vi.fn()
      render(<BatchAction {...defaultProps} onEditMetadata={mockOnEditMetadata} />)

      // Act
      fireEvent.click(screen.getByText(/metadata\.metadata/i))

      // Assert
      expect(mockOnEditMetadata).toHaveBeenCalledTimes(1)
    })

    it('should call onBatchReIndex when re-index button is clicked', () => {
      // Arrange
      const mockOnBatchReIndex = vi.fn()
      render(<BatchAction {...defaultProps} onBatchReIndex={mockOnBatchReIndex} />)

      // Act
      fireEvent.click(screen.getByText(/batchAction\.reIndex/i))

      // Assert
      expect(mockOnBatchReIndex).toHaveBeenCalledTimes(1)
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(<BatchAction {...defaultProps} className="custom-class" />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  // Selected count display tests
  describe('Selected Count', () => {
    it('should display correct count for single selection', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} selectedIds={['1']} />)

      // Assert
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should display correct count for multiple selections', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} selectedIds={['1', '2', '3', '4', '5']} />)

      // Assert
      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<BatchAction {...defaultProps} />)

      // Act
      rerender(<BatchAction {...defaultProps} selectedIds={['1', '2']} />)

      // Assert
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should handle empty selectedIds array', () => {
      // Arrange & Act
      render(<BatchAction {...defaultProps} selectedIds={[]} />)

      // Assert
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })
})
