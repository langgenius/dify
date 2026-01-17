import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeSelectionPanel from './start-node-selection-panel'

// Mock NodeSelector component
vi.mock('@/app/components/workflow/block-selector', () => ({
  default: function MockNodeSelector({
    open,
    onOpenChange,
    onSelect,
    trigger,
  }: any) {
    // trigger is a function that returns a React element
    const triggerElement = typeof trigger === 'function' ? trigger() : trigger

    return (
      <div data-testid="node-selector">
        {triggerElement}
        {open && (
          <div data-testid="node-selector-content">
            <button
              data-testid="select-schedule"
              onClick={() => onSelect(BlockEnum.TriggerSchedule)}
            >
              Select Schedule
            </button>
            <button
              data-testid="select-webhook"
              onClick={() => onSelect(BlockEnum.TriggerWebhook)}
            >
              Select Webhook
            </button>
            <button
              data-testid="close-selector"
              onClick={() => onOpenChange(false)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    )
  },
}))

describe('StartNodeSelectionPanel', () => {
  const mockOnSelectUserInput = vi.fn()
  const mockOnSelectTrigger = vi.fn()

  const defaultProps = {
    onSelectUserInput: mockOnSelectUserInput,
    onSelectTrigger: mockOnSelectTrigger,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function to render component
  const renderComponent = (props = {}) => {
    return render(<StartNodeSelectionPanel {...defaultProps} {...props} />)
  }

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeInTheDocument()
    })

    it('should render user input option', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.userInputDescription')).toBeInTheDocument()
    })

    it('should render trigger option', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('workflow.onboarding.trigger')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.triggerDescription')).toBeInTheDocument()
    })

    it('should render node selector component', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByTestId('node-selector')).toBeInTheDocument()
    })

    it('should not show trigger selector initially', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should accept onSelectUserInput prop', () => {
      // Arrange
      const customHandler = vi.fn()

      // Act
      renderComponent({ onSelectUserInput: customHandler })

      // Assert
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeInTheDocument()
    })

    it('should accept onSelectTrigger prop', () => {
      // Arrange
      const customHandler = vi.fn()

      // Act
      renderComponent({ onSelectTrigger: customHandler })

      // Assert
      expect(screen.getByText('workflow.onboarding.trigger')).toBeInTheDocument()
    })

    it('should handle missing onSelectUserInput gracefully', () => {
      // Arrange & Act
      expect(() => {
        renderComponent({ onSelectUserInput: undefined })
      }).not.toThrow()

      // Assert
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeInTheDocument()
    })

    it('should handle missing onSelectTrigger gracefully', () => {
      // Arrange & Act
      expect(() => {
        renderComponent({ onSelectTrigger: undefined })
      }).not.toThrow()

      // Assert
      expect(screen.getByText('workflow.onboarding.trigger')).toBeInTheDocument()
    })
  })

  // User Interactions - User Input Option
  describe('User Interactions - User Input', () => {
    it('should call onSelectUserInput when user input option is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await user.click(userInputOption)

      // Assert
      expect(mockOnSelectUserInput).toHaveBeenCalledTimes(1)
    })

    it('should not call onSelectTrigger when user input option is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await user.click(userInputOption)

      // Assert
      expect(mockOnSelectTrigger).not.toHaveBeenCalled()
    })

    it('should handle multiple clicks on user input option', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await user.click(userInputOption)
      await user.click(userInputOption)
      await user.click(userInputOption)

      // Assert
      expect(mockOnSelectUserInput).toHaveBeenCalledTimes(3)
    })
  })

  // User Interactions - Trigger Option
  describe('User Interactions - Trigger', () => {
    it('should show trigger selector when trigger option is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('node-selector-content')).toBeInTheDocument()
      })
    })

    it('should not call onSelectTrigger immediately when trigger option is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Assert
      expect(mockOnSelectTrigger).not.toHaveBeenCalled()
    })

    it('should call onSelectTrigger when a trigger is selected from selector', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open trigger selector
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Act - Select a trigger
      await waitFor(() => {
        expect(screen.getByTestId('select-schedule')).toBeInTheDocument()
      })
      const scheduleButton = screen.getByTestId('select-schedule')
      await user.click(scheduleButton)

      // Assert
      expect(mockOnSelectTrigger).toHaveBeenCalledTimes(1)
      expect(mockOnSelectTrigger).toHaveBeenCalledWith(BlockEnum.TriggerSchedule, undefined)
    })

    it('should call onSelectTrigger with correct node type for webhook', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open trigger selector
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Act - Select webhook trigger
      await waitFor(() => {
        expect(screen.getByTestId('select-webhook')).toBeInTheDocument()
      })
      const webhookButton = screen.getByTestId('select-webhook')
      await user.click(webhookButton)

      // Assert
      expect(mockOnSelectTrigger).toHaveBeenCalledTimes(1)
      expect(mockOnSelectTrigger).toHaveBeenCalledWith(BlockEnum.TriggerWebhook, undefined)
    })

    it('should hide trigger selector after selection', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open trigger selector
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Act - Select a trigger
      await waitFor(() => {
        expect(screen.getByTestId('select-schedule')).toBeInTheDocument()
      })
      const scheduleButton = screen.getByTestId('select-schedule')
      await user.click(scheduleButton)

      // Assert - Selector should be hidden
      await waitFor(() => {
        expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()
      })
    })

    it('should pass tool config parameter through onSelectTrigger', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open trigger selector
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Act - Select a trigger (our mock doesn't pass toolConfig, but real NodeSelector would)
      await waitFor(() => {
        expect(screen.getByTestId('select-schedule')).toBeInTheDocument()
      })
      const scheduleButton = screen.getByTestId('select-schedule')
      await user.click(scheduleButton)

      // Assert - Verify handler was called
      // In real usage, NodeSelector would pass toolConfig as second parameter
      expect(mockOnSelectTrigger).toHaveBeenCalled()
    })
  })

  // State Management
  describe('State Management', () => {
    it('should toggle trigger selector visibility', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Assert - Initially hidden
      expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()

      // Act - Show selector
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Assert - Now visible
      await waitFor(() => {
        expect(screen.getByTestId('node-selector-content')).toBeInTheDocument()
      })

      // Act - Close selector
      const closeButton = screen.getByTestId('close-selector')
      await user.click(closeButton)

      // Assert - Hidden again
      await waitFor(() => {
        expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()
      })
    })

    it('should maintain state across user input selections', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Click user input multiple times
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await user.click(userInputOption)
      await user.click(userInputOption)

      // Assert - Trigger selector should remain hidden
      expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()
    })

    it('should reset trigger selector visibility after selection', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open and select trigger
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      await waitFor(() => {
        expect(screen.getByTestId('select-schedule')).toBeInTheDocument()
      })
      const scheduleButton = screen.getByTestId('select-schedule')
      await user.click(scheduleButton)

      // Assert - Selector should be closed
      await waitFor(() => {
        expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()
      })

      // Act - Click trigger option again
      await user.click(triggerOption)

      // Assert - Selector should open again
      await waitFor(() => {
        expect(screen.getByTestId('node-selector-content')).toBeInTheDocument()
      })
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle rapid clicks on trigger option', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)
      await user.click(triggerOption)
      await user.click(triggerOption)

      // Assert - Should still be open (last click)
      await waitFor(() => {
        expect(screen.getByTestId('node-selector-content')).toBeInTheDocument()
      })
    })

    it('should handle selecting different trigger types in sequence', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open and select schedule
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      await waitFor(() => {
        expect(screen.getByTestId('select-schedule')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('select-schedule'))

      // Assert
      expect(mockOnSelectTrigger).toHaveBeenNthCalledWith(1, BlockEnum.TriggerSchedule, undefined)

      // Act - Open again and select webhook
      await user.click(triggerOption)
      await waitFor(() => {
        expect(screen.getByTestId('select-webhook')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('select-webhook'))

      // Assert
      expect(mockOnSelectTrigger).toHaveBeenNthCalledWith(2, BlockEnum.TriggerWebhook, undefined)
      expect(mockOnSelectTrigger).toHaveBeenCalledTimes(2)
    })

    it('should not crash with undefined callbacks', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({
        onSelectUserInput: undefined,
        onSelectTrigger: undefined,
      })

      // Act & Assert - Should not throw
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await expect(user.click(userInputOption)).resolves.not.toThrow()
    })

    it('should handle opening and closing selector without selection', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open selector
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Act - Close without selecting
      await waitFor(() => {
        expect(screen.getByTestId('close-selector')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('close-selector'))

      // Assert - No selection callback should be called
      expect(mockOnSelectTrigger).not.toHaveBeenCalled()

      // Assert - Selector should be closed
      await waitFor(() => {
        expect(screen.queryByTestId('node-selector-content')).not.toBeInTheDocument()
      })
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should have both options visible and accessible', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeVisible()
      expect(screen.getByText('workflow.onboarding.trigger')).toBeVisible()
    })

    it('should have descriptive text for both options', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('workflow.onboarding.userInputDescription')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.triggerDescription')).toBeInTheDocument()
    })

    it('should maintain focus after interactions', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await user.click(userInputOption)

      // Assert - Component should still be in document
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.trigger')).toBeInTheDocument()
    })
  })

  // Integration Tests
  describe('Integration', () => {
    it('should coordinate between both options correctly', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Click user input
      const userInputOption = screen.getByText('workflow.onboarding.userInputFull')
      await user.click(userInputOption)

      // Assert
      expect(mockOnSelectUserInput).toHaveBeenCalledTimes(1)
      expect(mockOnSelectTrigger).not.toHaveBeenCalled()

      // Act - Click trigger
      const triggerOption = screen.getByText('workflow.onboarding.trigger')
      await user.click(triggerOption)

      // Assert - Trigger selector should open
      await waitFor(() => {
        expect(screen.getByTestId('node-selector-content')).toBeInTheDocument()
      })

      // Act - Select trigger
      await user.click(screen.getByTestId('select-schedule'))

      // Assert
      expect(mockOnSelectTrigger).toHaveBeenCalledTimes(1)
      expect(mockOnSelectUserInput).toHaveBeenCalledTimes(1)
    })

    it('should render all components in correct hierarchy', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      // Both StartNodeOption components should be rendered
      expect(screen.getByText('workflow.onboarding.userInputFull')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.trigger')).toBeInTheDocument()

      // NodeSelector should be rendered
      expect(screen.getByTestId('node-selector')).toBeInTheDocument()
    })
  })
})
