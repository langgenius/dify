import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import ConfirmModal from './index'

// Test utilities
const defaultProps = {
  show: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
}

const renderComponent = (props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) => {
  const mergedProps = { ...defaultProps, ...props }
  return render(<ConfirmModal {...mergedProps} />)
}

describe('ConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should render when show prop is true', () => {
      // Arrange & Act
      renderComponent({ show: true })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should not render when show prop is false', () => {
      // Arrange & Act
      renderComponent({ show: false })

      // Assert
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render warning icon with proper styling', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const iconContainer = document.querySelector('.rounded-xl')
      expect(iconContainer).toBeInTheDocument()
      expect(iconContainer).toHaveClass('border-[0.5px]')
      expect(iconContainer).toHaveClass('bg-background-section')
    })

    it('should render translated title and description', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.confirmTip')).toBeInTheDocument()
    })

    it('should render action buttons with translated text', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByText('common.operation.confirm')).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should handle missing onConfirm prop gracefully', () => {
      // Arrange & Act - Should not crash when onConfirm is undefined
      expect(() => {
        renderComponent({ onConfirm: undefined })
      }).not.toThrow()

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('common.operation.confirm')).toBeInTheDocument()
    })

    it('should apply default styling and width constraints', () => {
      // Arrange & Act
      renderComponent()

      // Assert - Check for the dialog panel with modal content
      // The real modal structure has nested divs, we need to find the one with our classes
      const dialogContent = document.querySelector('.relative.rounded-2xl')
      expect(dialogContent).toBeInTheDocument()
      expect(dialogContent).toHaveClass('w-[600px]')
      expect(dialogContent).toHaveClass('max-w-[600px]')
      expect(dialogContent).toHaveClass('p-8')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderComponent({ onClose })

      // Act - Find the close button and click it
      const closeButton = document.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument() // Ensure the button is found before clicking
      await user.click(closeButton!)

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when cancel button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderComponent({ onClose })

      // Act
      const cancelButton = screen.getByText('common.operation.cancel')
      await user.click(cancelButton)

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm when confirm button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      renderComponent({ onConfirm })

      // Act
      const confirmButton = screen.getByText('common.operation.confirm')
      await user.click(confirmButton)

      // Assert
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('should not throw error when confirm button is clicked without onConfirm', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ onConfirm: undefined })
      const confirmButton = screen.getByText('common.operation.confirm')

      // Act & Assert - This will fail the test if user.click throws an unhandled error
      await user.click(confirmButton)
    })

    it('should have correct button variants', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const confirmButton = screen.getByText('common.operation.confirm')
      expect(confirmButton).toHaveClass('btn-warning')
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle rapid show/hide toggling', async () => {
      // Arrange
      const { rerender } = renderComponent({ show: false })

      // Assert - Initially not shown
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      // Act - Show modal
      await act(async () => {
        rerender(<ConfirmModal {...defaultProps} show={true} />)
      })

      // Assert - Now shown
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Act - Hide modal again
      await act(async () => {
        rerender(<ConfirmModal {...defaultProps} show={false} />)
      })

      // Assert - Hidden again (wait for transition to complete)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('should handle multiple quick clicks on close button', async () => {
      // Arrange
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderComponent({ onClose })

      const closeButton = document.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument() // Ensure the button is found before clicking

      // Act
      await user.click(closeButton!)
      await user.click(closeButton!)
      await user.click(closeButton!)

      // Assert
      expect(onClose).toHaveBeenCalledTimes(3)
    })

    it('should handle multiple quick clicks on confirm button', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      renderComponent({ onConfirm })

      // Act
      const confirmButton = screen.getByText('common.operation.confirm')
      await user.click(confirmButton)
      await user.click(confirmButton)
      await user.click(confirmButton)

      // Assert
      expect(onConfirm).toHaveBeenCalledTimes(3)
    })

    it('should handle multiple quick clicks on cancel button', async () => {
      // Arrange
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderComponent({ onClose })

      // Act - Click cancel button twice
      const cancelButton = screen.getByText('common.operation.cancel')
      await user.click(cancelButton)
      await user.click(cancelButton)

      // Assert
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })

  // Accessibility tests
  describe('Accessibility', () => {
    it('should have proper button roles', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
      expect(buttons[0]).toHaveTextContent('common.operation.cancel')
      expect(buttons[1]).toHaveTextContent('common.operation.confirm')
    })

    it('should have proper text hierarchy', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const title = screen.getByText('tools.createTool.confirmTitle')
      expect(title).toBeInTheDocument()

      const description = screen.getByText('tools.createTool.confirmTip')
      expect(description).toBeInTheDocument()
    })

    it('should have focusable interactive elements', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeEnabled()
      })
    })
  })
})
