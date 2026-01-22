import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowOnboardingModal from './index'

// Mock Modal component
vi.mock('@/app/components/base/modal', () => ({
  default: function MockModal({
    isShow,
    onClose,
    children,
    closable,
  }: any) {
    if (!isShow)
      return null

    return (
      <div data-testid="modal" role="dialog">
        {closable && (
          <button data-testid="modal-close-button" onClick={onClose}>
            Close
          </button>
        )}
        {children}
      </div>
    )
  },
}))

// Mock useDocLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

// Mock StartNodeSelectionPanel (using real component would be better for integration,
// but for this test we'll mock to control behavior)
vi.mock('./start-node-selection-panel', () => ({
  default: function MockStartNodeSelectionPanel({
    onSelectUserInput,
    onSelectTrigger,
  }: any) {
    return (
      <div data-testid="start-node-selection-panel">
        <button data-testid="select-user-input" onClick={onSelectUserInput}>
          Select User Input
        </button>
        <button
          data-testid="select-trigger-schedule"
          onClick={() => onSelectTrigger(BlockEnum.TriggerSchedule)}
        >
          Select Trigger Schedule
        </button>
        <button
          data-testid="select-trigger-webhook"
          onClick={() => onSelectTrigger(BlockEnum.TriggerWebhook, { config: 'test' })}
        >
          Select Trigger Webhook
        </button>
      </div>
    )
  },
}))

describe('WorkflowOnboardingModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSelectStartNode = vi.fn()

  const defaultProps = {
    isShow: true,
    onClose: mockOnClose,
    onSelectStartNode: mockOnSelectStartNode,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function to render component
  const renderComponent = (props = {}) => {
    return render(<WorkflowOnboardingModal {...defaultProps} {...props} />)
  }

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should render modal when isShow is true', () => {
      // Arrange & Act
      renderComponent({ isShow: true })

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should not render modal when isShow is false', () => {
      // Arrange & Act
      renderComponent({ isShow: false })

      // Assert
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
    })

    it('should render modal title', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('workflow.onboarding.title')).toBeInTheDocument()
    })

    it('should render modal description', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert - Check both parts of description (separated by link)
      const descriptionDiv = container.querySelector('.body-xs-regular.leading-4')
      expect(descriptionDiv).toBeInTheDocument()
      expect(descriptionDiv).toHaveTextContent('workflow.onboarding.description')
    })

    it('should render StartNodeSelectionPanel', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByTestId('start-node-selection-panel')).toBeInTheDocument()
    })

    it('should render ESC tip when modal is shown', () => {
      // Arrange & Act
      renderComponent({ isShow: true })

      // Assert
      expect(screen.getByText('workflow.onboarding.escTip.press')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.escTip.key')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.escTip.toDismiss')).toBeInTheDocument()
    })

    it('should not render ESC tip when modal is hidden', () => {
      // Arrange & Act
      renderComponent({ isShow: false })

      // Assert
      expect(screen.queryByText('workflow.onboarding.escTip.press')).not.toBeInTheDocument()
    })

    it('should have correct styling for title', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const title = screen.getByText('workflow.onboarding.title')
      expect(title).toHaveClass('title-2xl-semi-bold')
      expect(title).toHaveClass('text-text-primary')
    })

    it('should have modal close button', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByTestId('modal-close-button')).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should accept isShow prop', () => {
      // Arrange & Act
      const { rerender } = renderComponent({ isShow: false })

      // Assert
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument()

      // Act
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} />)

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should accept onClose prop', () => {
      // Arrange
      const customOnClose = vi.fn()

      // Act
      renderComponent({ onClose: customOnClose })

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should accept onSelectStartNode prop', () => {
      // Arrange
      const customHandler = vi.fn()

      // Act
      renderComponent({ onSelectStartNode: customHandler })

      // Assert
      expect(screen.getByTestId('start-node-selection-panel')).toBeInTheDocument()
    })

    it('should handle undefined onClose gracefully', () => {
      // Arrange & Act
      expect(() => {
        renderComponent({ onClose: undefined })
      }).not.toThrow()

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should handle undefined onSelectStartNode gracefully', () => {
      // Arrange & Act
      expect(() => {
        renderComponent({ onSelectStartNode: undefined })
      }).not.toThrow()

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  // User Interactions - Start Node Selection
  describe('User Interactions - Start Node Selection', () => {
    it('should call onSelectStartNode with Start block when user input is selected', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const userInputButton = screen.getByTestId('select-user-input')
      await user.click(userInputButton)

      // Assert
      expect(mockOnSelectStartNode).toHaveBeenCalledTimes(1)
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
    })

    it('should call onClose after selecting user input', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const userInputButton = screen.getByTestId('select-user-input')
      await user.click(userInputButton)

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onSelectStartNode with trigger type when trigger is selected', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const triggerButton = screen.getByTestId('select-trigger-schedule')
      await user.click(triggerButton)

      // Assert
      expect(mockOnSelectStartNode).toHaveBeenCalledTimes(1)
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerSchedule, undefined)
    })

    it('should call onClose after selecting trigger', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const triggerButton = screen.getByTestId('select-trigger-schedule')
      await user.click(triggerButton)

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should pass tool config when selecting trigger with config', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const webhookButton = screen.getByTestId('select-trigger-webhook')
      await user.click(webhookButton)

      // Assert
      expect(mockOnSelectStartNode).toHaveBeenCalledTimes(1)
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerWebhook, { config: 'test' })
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  // User Interactions - Modal Close
  describe('User Interactions - Modal Close', () => {
    it('should call onClose when close button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const closeButton = screen.getByTestId('modal-close-button')
      await user.click(closeButton)

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onSelectStartNode when closing without selection', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const closeButton = screen.getByTestId('modal-close-button')
      await user.click(closeButton)

      // Assert
      expect(mockOnSelectStartNode).not.toHaveBeenCalled()
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  // Keyboard Event Handling
  describe('Keyboard Event Handling', () => {
    it('should call onClose when ESC key is pressed', () => {
      // Arrange
      renderComponent({ isShow: true })

      // Act
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when other keys are pressed', () => {
      // Arrange
      renderComponent({ isShow: true })

      // Act
      fireEvent.keyDown(document, { key: 'Enter', code: 'Enter' })
      fireEvent.keyDown(document, { key: 'Tab', code: 'Tab' })
      fireEvent.keyDown(document, { key: 'a', code: 'KeyA' })

      // Assert
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should not call onClose when ESC is pressed but modal is hidden', () => {
      // Arrange
      renderComponent({ isShow: false })

      // Act
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should clean up event listener on unmount', () => {
      // Arrange
      const { unmount } = renderComponent({ isShow: true })

      // Act
      unmount()
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should update event listener when isShow changes', () => {
      // Arrange
      const { rerender } = renderComponent({ isShow: true })

      // Act - Press ESC when shown
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)

      // Act - Hide modal and clear mock
      mockOnClose.mockClear()
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={false} />)

      // Act - Press ESC when hidden
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should handle multiple ESC key presses', () => {
      // Arrange
      renderComponent({ isShow: true })

      // Act
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(3)
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle rapid modal show/hide toggling', async () => {
      // Arrange
      const { rerender } = renderComponent({ isShow: false })

      // Assert
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument()

      // Act
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} />)

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()

      // Act
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={false} />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
      })
    })

    it('should handle selecting multiple nodes in sequence', async () => {
      // Arrange
      const user = userEvent.setup()
      const { rerender } = renderComponent()

      // Act - Select user input
      await user.click(screen.getByTestId('select-user-input'))

      // Assert
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
      expect(mockOnClose).toHaveBeenCalledTimes(1)

      // Act - Re-show modal and select trigger
      mockOnClose.mockClear()
      mockOnSelectStartNode.mockClear()
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} />)

      await user.click(screen.getByTestId('select-trigger-schedule'))

      // Assert
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerSchedule, undefined)
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should handle prop updates correctly', () => {
      // Arrange
      const { rerender } = renderComponent({ isShow: true })

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()

      // Act - Update props
      const newOnClose = vi.fn()
      const newOnSelectStartNode = vi.fn()
      rerender(
        <WorkflowOnboardingModal
          isShow={true}
          onClose={newOnClose}
          onSelectStartNode={newOnSelectStartNode}
        />,
      )

      // Assert - Modal still renders with new props
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should handle onClose being called multiple times', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      await user.click(screen.getByTestId('modal-close-button'))
      await user.click(screen.getByTestId('modal-close-button'))

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(2)
    })

    it('should maintain modal state when props change', () => {
      // Arrange
      const { rerender } = renderComponent({ isShow: true })

      // Assert
      expect(screen.getByTestId('modal')).toBeInTheDocument()

      // Act - Change onClose handler
      const newOnClose = vi.fn()
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} onClose={newOnClose} />)

      // Assert - Modal should still be visible
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should have dialog role', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should have proper heading hierarchy', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert
      const heading = container.querySelector('h3')
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('workflow.onboarding.title')
    })

    it('should have keyboard navigation support via ESC key', () => {
      // Arrange
      renderComponent({ isShow: true })

      // Act
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should have visible ESC key hint', () => {
      // Arrange & Act
      renderComponent({ isShow: true })

      // Assert
      const escKey = screen.getByText('workflow.onboarding.escTip.key')
      expect(escKey.closest('kbd')).toBeInTheDocument()
      expect(escKey.closest('kbd')).toHaveClass('system-kbd')
    })

    it('should have descriptive text for ESC functionality', () => {
      // Arrange & Act
      renderComponent({ isShow: true })

      // Assert
      expect(screen.getByText('workflow.onboarding.escTip.press')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.escTip.toDismiss')).toBeInTheDocument()
    })

    it('should have proper text color classes', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const title = screen.getByText('workflow.onboarding.title')
      expect(title).toHaveClass('text-text-primary')
    })
  })

  // Integration Tests
  describe('Integration', () => {
    it('should complete full flow of selecting user input node', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Assert - Initial state
      expect(screen.getByTestId('modal')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.title')).toBeInTheDocument()
      expect(screen.getByTestId('start-node-selection-panel')).toBeInTheDocument()

      // Act - Select user input
      await user.click(screen.getByTestId('select-user-input'))

      // Assert - Callbacks called
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should complete full flow of selecting trigger node', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Assert - Initial state
      expect(screen.getByTestId('modal')).toBeInTheDocument()

      // Act - Select trigger
      await user.click(screen.getByTestId('select-trigger-webhook'))

      // Assert - Callbacks called with config
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerWebhook, { config: 'test' })
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should render all components in correct hierarchy', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert - Modal is the root
      expect(screen.getByTestId('modal')).toBeInTheDocument()

      // Assert - Header elements
      const heading = container.querySelector('h3')
      expect(heading).toBeInTheDocument()

      // Assert - Selection panel
      expect(screen.getByTestId('start-node-selection-panel')).toBeInTheDocument()

      // Assert - ESC tip
      expect(screen.getByText('workflow.onboarding.escTip.key')).toBeInTheDocument()
    })

    it('should coordinate between keyboard and click interactions', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Click close button
      await user.click(screen.getByTestId('modal-close-button'))

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)

      // Act - Clear and try ESC key
      mockOnClose.mockClear()
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      // Assert
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })
})
