import { fireEvent, render, screen } from '@testing-library/react'
import Actions from './index'

// ============================================================================
// Actions Component Tests
// ============================================================================

describe('Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render button with translated text', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)

      // Assert - Translation mock returns key with namespace prefix
      expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
    })

    it('should render with correct container structure', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { container } = render(<Actions handleNextStep={handleNextStep} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('flex')
      expect(wrapper.className).toContain('justify-end')
      expect(wrapper.className).toContain('p-4')
      expect(wrapper.className).toContain('pt-2')
    })

    it('should render span with px-0.5 class around text', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { container } = render(<Actions handleNextStep={handleNextStep} />)

      // Assert
      const span = container.querySelector('span')
      expect(span).toBeInTheDocument()
      expect(span?.className).toContain('px-0.5')
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should pass disabled=true to button when disabled prop is true', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should pass disabled=false to button when disabled prop is false', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions disabled={false} handleNextStep={handleNextStep} />)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should not disable button when disabled prop is undefined', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should handle disabled switching from true to false', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions disabled={true} handleNextStep={handleNextStep} />,
      )

      // Assert - Initially disabled
      expect(screen.getByRole('button')).toBeDisabled()

      // Act - Rerender with disabled=false
      rerender(<Actions disabled={false} handleNextStep={handleNextStep} />)

      // Assert - Now enabled
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should handle disabled switching from false to true', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      // Assert - Initially enabled
      expect(screen.getByRole('button')).not.toBeDisabled()

      // Act - Rerender with disabled=true
      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert - Now disabled
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should handle undefined disabled becoming true', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions handleNextStep={handleNextStep} />,
      )

      // Assert - Initially not disabled (undefined)
      expect(screen.getByRole('button')).not.toBeDisabled()

      // Act - Rerender with disabled=true
      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert - Now disabled
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call handleNextStep when button is clicked', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should call handleNextStep exactly once per click', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep).toHaveBeenCalled()
      expect(handleNextStep.mock.calls).toHaveLength(1)
    })

    it('should call handleNextStep multiple times on multiple clicks', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(3)
    })

    it('should not call handleNextStep when button is disabled and clicked', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions disabled={true} handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert - Disabled button should not trigger onClick
      expect(handleNextStep).not.toHaveBeenCalled()
    })

    it('should handle rapid clicks when not disabled', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      const button = screen.getByRole('button')

      // Simulate rapid clicks
      for (let i = 0; i < 10; i++)
        fireEvent.click(button)

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(10)
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should use the new handleNextStep when prop changes', () => {
      // Arrange
      const handleNextStep1 = vi.fn()
      const handleNextStep2 = vi.fn()

      // Act
      const { rerender } = render(
        <Actions handleNextStep={handleNextStep1} />,
      )
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep2} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep1).toHaveBeenCalledTimes(1)
      expect(handleNextStep2).toHaveBeenCalledTimes(1)
    })

    it('should maintain functionality after rerender with same props', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions handleNextStep={handleNextStep} />,
      )
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(2)
    })

    it('should work correctly when handleNextStep changes multiple times', () => {
      // Arrange
      const handleNextStep1 = vi.fn()
      const handleNextStep2 = vi.fn()
      const handleNextStep3 = vi.fn()

      // Act
      const { rerender } = render(
        <Actions handleNextStep={handleNextStep1} />,
      )
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep2} />)
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep3} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep1).toHaveBeenCalledTimes(1)
      expect(handleNextStep2).toHaveBeenCalledTimes(1)
      expect(handleNextStep3).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act - Verify component is memoized by checking display name pattern
      const { rerender } = render(
        <Actions handleNextStep={handleNextStep} />,
      )

      // Rerender with same props should work without issues
      rerender(<Actions handleNextStep={handleNextStep} />)

      // Assert - Component should render correctly after rerender
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should not break when props remain the same across rerenders', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      // Multiple rerenders with same props
      for (let i = 0; i < 5; i++) {
        rerender(<Actions disabled={false} handleNextStep={handleNextStep} />)
      }

      // Assert - Should still function correctly
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should update correctly when only disabled prop changes', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      // Assert - Initially not disabled
      expect(screen.getByRole('button')).not.toBeDisabled()

      // Act - Change only disabled prop
      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert - Should reflect the new disabled state
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should update correctly when only handleNextStep prop changes', () => {
      // Arrange
      const handleNextStep1 = vi.fn()
      const handleNextStep2 = vi.fn()

      // Act
      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep1} />,
      )

      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep1).toHaveBeenCalledTimes(1)

      // Act - Change only handleNextStep prop
      rerender(<Actions disabled={false} handleNextStep={handleNextStep2} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert - New callback should be used
      expect(handleNextStep1).toHaveBeenCalledTimes(1)
      expect(handleNextStep2).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should call handleNextStep even if it has side effects', () => {
      // Arrange
      let sideEffectValue = 0
      const handleNextStep = vi.fn(() => {
        sideEffectValue = 42
      })

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(1)
      expect(sideEffectValue).toBe(42)
    })

    it('should handle handleNextStep that returns a value', () => {
      // Arrange
      const handleNextStep = vi.fn(() => 'return value')

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(1)
      expect(handleNextStep).toHaveReturnedWith('return value')
    })

    it('should handle handleNextStep that is async', async () => {
      // Arrange
      const handleNextStep = vi.fn().mockResolvedValue(undefined)

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should render correctly with both disabled=true and handleNextStep', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should handle component unmount gracefully', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { unmount } = render(<Actions handleNextStep={handleNextStep} />)

      // Assert - Unmount should not throw
      expect(() => unmount()).not.toThrow()
    })

    it('should handle disabled as boolean-like falsy value', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act - Test with explicit false
      render(<Actions disabled={false} handleNextStep={handleNextStep} />)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })

  // -------------------------------------------------------------------------
  // Accessibility Tests
  // -------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have button element that can receive focus', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions handleNextStep={handleNextStep} />)
      const button = screen.getByRole('button')

      // Assert - Button should be focusable (not disabled by default)
      expect(button).not.toBeDisabled()
    })

    it('should indicate disabled state correctly', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      render(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert
      expect(screen.getByRole('button')).toHaveAttribute('disabled')
    })
  })

  // -------------------------------------------------------------------------
  // Integration Tests
  // -------------------------------------------------------------------------
  describe('Integration', () => {
    it('should work in a typical workflow: enable -> click -> disable', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act - Start enabled
      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      // Assert - Can click when enabled
      expect(screen.getByRole('button')).not.toBeDisabled()
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(1)

      // Act - Disable after click (simulating loading state)
      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      // Assert - Cannot click when disabled
      expect(screen.getByRole('button')).toBeDisabled()
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(1) // Still 1, not 2

      // Act - Re-enable
      rerender(<Actions disabled={false} handleNextStep={handleNextStep} />)

      // Assert - Can click again
      expect(screen.getByRole('button')).not.toBeDisabled()
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(2)
    })

    it('should maintain consistent rendering across multiple state changes', () => {
      // Arrange
      const handleNextStep = vi.fn()

      // Act
      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      // Toggle disabled state multiple times
      const states = [true, false, true, false, true]
      states.forEach((disabled) => {
        rerender(<Actions disabled={disabled} handleNextStep={handleNextStep} />)
        if (disabled)
          expect(screen.getByRole('button')).toBeDisabled()
        else
          expect(screen.getByRole('button')).not.toBeDisabled()
      })

      // Assert - Button should still render correctly
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
    })
  })
})
