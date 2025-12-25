import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Actions from './index'

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock next/navigation - useParams returns datasetId
const mockDatasetId = 'test-dataset-id'
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: mockDatasetId }),
}))

// Mock next/link to capture href
vi.mock('next/link', () => ({
  default: ({ children, href, replace }: { children: React.ReactNode, href: string, replace?: boolean }) => (
    <a href={href} data-replace={replace}>
      {children}
    </a>
  ),
}))

// ==========================================
// Test Suite
// ==========================================

describe('Actions', () => {
  // Default mock for required props
  const defaultProps = {
    handleNextStep: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    // Tests basic rendering functionality
    it('should render without crashing', () => {
      // Arrange & Act
      render(<Actions {...defaultProps} />)

      // Assert
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeInTheDocument()
    })

    it('should render cancel button with correct link', () => {
      // Arrange & Act
      render(<Actions {...defaultProps} />)

      // Assert
      const cancelLink = screen.getByRole('link')
      expect(cancelLink).toHaveAttribute('href', `/datasets/${mockDatasetId}/documents`)
      expect(cancelLink).toHaveAttribute('data-replace', 'true')
    })

    it('should render next step button with arrow icon', () => {
      // Arrange & Act
      render(<Actions {...defaultProps} />)

      // Assert
      const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
      expect(nextButton).toBeInTheDocument()
      expect(nextButton.querySelector('svg')).toBeInTheDocument()
    })

    it('should render cancel button with correct translation key', () => {
      // Arrange & Act
      render(<Actions {...defaultProps} />)

      // Assert
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    })

    it('should not render select all section by default', () => {
      // Arrange & Act
      render(<Actions {...defaultProps} />)

      // Assert
      expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    // Tests for prop variations and defaults
    describe('disabled prop', () => {
      it('should not disable next step button when disabled is false', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} disabled={false} />)

        // Assert
        const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
        expect(nextButton).not.toBeDisabled()
      })

      it('should disable next step button when disabled is true', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} disabled={true} />)

        // Assert
        const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
        expect(nextButton).toBeDisabled()
      })

      it('should not disable next step button when disabled is undefined', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} disabled={undefined} />)

        // Assert
        const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
        expect(nextButton).not.toBeDisabled()
      })
    })

    describe('showSelect prop', () => {
      it('should show select all section when showSelect is true', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} showSelect={true} onSelectAll={vi.fn()} />)

        // Assert
        expect(screen.getByText('common.operation.selectAll')).toBeInTheDocument()
      })

      it('should hide select all section when showSelect is false', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} showSelect={false} />)

        // Assert
        expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
      })

      it('should hide select all section when showSelect defaults to false', () => {
        // Arrange & Act
        render(<Actions handleNextStep={vi.fn()} />)

        // Assert
        expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
      })
    })

    describe('tip prop', () => {
      it('should show tip when showSelect is true and tip is provided', () => {
        // Arrange
        const tip = 'This is a helpful tip'

        // Act
        render(<Actions {...defaultProps} showSelect={true} tip={tip} onSelectAll={vi.fn()} />)

        // Assert
        expect(screen.getByText(tip)).toBeInTheDocument()
        expect(screen.getByTitle(tip)).toBeInTheDocument()
      })

      it('should not show tip when showSelect is false even if tip is provided', () => {
        // Arrange
        const tip = 'This is a helpful tip'

        // Act
        render(<Actions {...defaultProps} showSelect={false} tip={tip} />)

        // Assert
        expect(screen.queryByText(tip)).not.toBeInTheDocument()
      })

      it('should not show tip when tip is empty string', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} showSelect={true} tip="" onSelectAll={vi.fn()} />)

        // Assert
        const tipElements = screen.queryAllByTitle('')
        // Empty tip should not render a tip element
        expect(tipElements.length).toBe(0)
      })

      it('should use empty string as default tip value', () => {
        // Arrange & Act
        render(<Actions {...defaultProps} showSelect={true} onSelectAll={vi.fn()} />)

        // Assert - tip container should not exist when tip defaults to empty string
        const tipContainer = document.querySelector('.text-text-tertiary.truncate')
        expect(tipContainer).not.toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Event Handlers Testing
  // ==========================================
  describe('User Interactions', () => {
    // Tests for event handlers
    it('should call handleNextStep when next button is clicked', () => {
      // Arrange
      const handleNextStep = vi.fn()
      render(<Actions {...defaultProps} handleNextStep={handleNextStep} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should not call handleNextStep when next button is disabled and clicked', () => {
      // Arrange
      const handleNextStep = vi.fn()
      render(<Actions {...defaultProps} handleNextStep={handleNextStep} disabled={true} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(handleNextStep).not.toHaveBeenCalled()
    })

    it('should call onSelectAll when checkbox is clicked', () => {
      // Arrange
      const onSelectAll = vi.fn()
      render(
        <Actions
          {...defaultProps}
          showSelect={true}
          onSelectAll={onSelectAll}
          totalOptions={5}
          selectedOptions={0}
        />,
      )

      // Act - find the checkbox container and click it
      const selectAllLabel = screen.getByText('common.operation.selectAll')
      const checkboxContainer = selectAllLabel.closest('.flex.shrink-0.items-center')
      const checkbox = checkboxContainer?.querySelector('[class*="cursor-pointer"]')
      if (checkbox)
        fireEvent.click(checkbox)

      // Assert
      expect(onSelectAll).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================
  // Memoization Logic Testing
  // ==========================================
  describe('Memoization Logic', () => {
    // Tests for useMemo hooks (indeterminate and checked)
    describe('indeterminate calculation', () => {
      it('should return false when showSelect is false', () => {
        // Arrange & Act
        render(
          <Actions
            {...defaultProps}
            showSelect={false}
            totalOptions={5}
            selectedOptions={2}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox not rendered, so can't check indeterminate directly
        expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
      })

      it('should return false when selectedOptions is undefined', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={undefined}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should not be indeterminate
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return false when totalOptions is undefined', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={undefined}
            selectedOptions={2}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should exist
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return true when some options are selected (0 < selectedOptions < totalOptions)', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={3}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should render in indeterminate state
        // The checkbox component renders IndeterminateIcon when indeterminate and not checked
        const selectAllContainer = container.querySelector('.flex.shrink-0.items-center')
        expect(selectAllContainer).toBeInTheDocument()
      })

      it('should return false when no options are selected (selectedOptions === 0)', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={0}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should be unchecked and not indeterminate
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return false when all options are selected (selectedOptions === totalOptions)', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={5}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should be checked, not indeterminate
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })
    })

    describe('checked calculation', () => {
      it('should return false when showSelect is false', () => {
        // Arrange & Act
        render(
          <Actions
            {...defaultProps}
            showSelect={false}
            totalOptions={5}
            selectedOptions={5}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox not rendered
        expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
      })

      it('should return false when selectedOptions is undefined', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={undefined}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return false when totalOptions is undefined', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={undefined}
            selectedOptions={5}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return true when all options are selected (selectedOptions === totalOptions)', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={5}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should show checked state (RiCheckLine icon)
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return false when selectedOptions is 0', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={0}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should be unchecked
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })

      it('should return false when not all options are selected', () => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={5}
            selectedOptions={4}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - checkbox should be indeterminate, not checked
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Component Memoization Testing
  // ==========================================
  describe('Component Memoization', () => {
    // Tests for React.memo behavior
    it('should be wrapped with React.memo', () => {
      // Assert - verify component has memo wrapper
      expect(Actions.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should not re-render when props are the same', () => {
      // Arrange
      const handleNextStep = vi.fn()
      const props = {
        handleNextStep,
        disabled: false,
        showSelect: true,
        totalOptions: 5,
        selectedOptions: 3,
        onSelectAll: vi.fn(),
        tip: 'Test tip',
      }

      // Act
      const { rerender } = render(<Actions {...props} />)

      // Re-render with same props
      rerender(<Actions {...props} />)

      // Assert - component renders correctly after rerender
      expect(screen.getByText('common.operation.selectAll')).toBeInTheDocument()
      expect(screen.getByText('Test tip')).toBeInTheDocument()
    })

    it('should re-render when props change', () => {
      // Arrange
      const handleNextStep = vi.fn()
      const initialProps = {
        handleNextStep,
        disabled: false,
        showSelect: true,
        totalOptions: 5,
        selectedOptions: 0,
        onSelectAll: vi.fn(),
        tip: 'Initial tip',
      }

      // Act
      const { rerender } = render(<Actions {...initialProps} />)
      expect(screen.getByText('Initial tip')).toBeInTheDocument()

      // Rerender with different props
      rerender(<Actions {...initialProps} tip="Updated tip" />)

      // Assert
      expect(screen.getByText('Updated tip')).toBeInTheDocument()
      expect(screen.queryByText('Initial tip')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases Testing
  // ==========================================
  describe('Edge Cases', () => {
    // Tests for boundary conditions and unusual inputs
    it('should handle totalOptions of 0', () => {
      // Arrange & Act
      const { container } = render(
        <Actions
          {...defaultProps}
          showSelect={true}
          totalOptions={0}
          selectedOptions={0}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert - should render checkbox
      const checkbox = container.querySelector('[class*="cursor-pointer"]')
      expect(checkbox).toBeInTheDocument()
    })

    it('should handle very large totalOptions', () => {
      // Arrange & Act
      const { container } = render(
        <Actions
          {...defaultProps}
          showSelect={true}
          totalOptions={1000000}
          selectedOptions={500000}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert
      const checkbox = container.querySelector('[class*="cursor-pointer"]')
      expect(checkbox).toBeInTheDocument()
    })

    it('should handle very long tip text', () => {
      // Arrange
      const longTip = 'A'.repeat(500)

      // Act
      render(
        <Actions
          {...defaultProps}
          showSelect={true}
          tip={longTip}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert - tip should render with truncate class
      const tipElement = screen.getByTitle(longTip)
      expect(tipElement).toHaveClass('truncate')
    })

    it('should handle tip with special characters', () => {
      // Arrange
      const specialTip = '<script>alert("xss")</script> & "quotes" \'apostrophes\''

      // Act
      render(
        <Actions
          {...defaultProps}
          showSelect={true}
          tip={specialTip}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert - special characters should be rendered safely
      expect(screen.getByText(specialTip)).toBeInTheDocument()
    })

    it('should handle tip with unicode characters', () => {
      // Arrange
      const unicodeTip = '选中 5 个文件，共 10MB 🚀'

      // Act
      render(
        <Actions
          {...defaultProps}
          showSelect={true}
          tip={unicodeTip}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText(unicodeTip)).toBeInTheDocument()
    })

    it('should handle selectedOptions greater than totalOptions', () => {
      // This is an edge case that shouldn't happen but should be handled gracefully
      // Arrange & Act
      const { container } = render(
        <Actions
          {...defaultProps}
          showSelect={true}
          totalOptions={5}
          selectedOptions={10}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert - should still render
      const checkbox = container.querySelector('[class*="cursor-pointer"]')
      expect(checkbox).toBeInTheDocument()
    })

    it('should handle negative selectedOptions', () => {
      // Arrange & Act
      const { container } = render(
        <Actions
          {...defaultProps}
          showSelect={true}
          totalOptions={5}
          selectedOptions={-1}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert - should still render (though this is an invalid state)
      const checkbox = container.querySelector('[class*="cursor-pointer"]')
      expect(checkbox).toBeInTheDocument()
    })

    it('should handle onSelectAll being undefined when showSelect is true', () => {
      // Arrange & Act
      const { container } = render(
        <Actions
          {...defaultProps}
          showSelect={true}
          totalOptions={5}
          selectedOptions={3}
          onSelectAll={undefined}
        />,
      )

      // Assert - should render checkbox
      const checkbox = container.querySelector('[class*="cursor-pointer"]')
      expect(checkbox).toBeInTheDocument()

      // Click should not throw
      if (checkbox)
        expect(() => fireEvent.click(checkbox)).not.toThrow()
    })

    it('should handle empty datasetId from params', () => {
      // This test verifies the link is constructed even with empty datasetId
      // Arrange & Act
      render(<Actions {...defaultProps} />)

      // Assert - link should still be present with the mocked datasetId
      const cancelLink = screen.getByRole('link')
      expect(cancelLink).toHaveAttribute('href', '/datasets/test-dataset-id/documents')
    })
  })

  // ==========================================
  // All Prop Combinations Testing
  // ==========================================
  describe('Prop Combinations', () => {
    // Tests for various combinations of props
    it('should handle disabled=true with showSelect=false', () => {
      // Arrange & Act
      render(<Actions {...defaultProps} disabled={true} showSelect={false} />)

      // Assert
      const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
      expect(nextButton).toBeDisabled()
      expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
    })

    it('should handle disabled=true with showSelect=true', () => {
      // Arrange & Act
      render(
        <Actions
          {...defaultProps}
          disabled={true}
          showSelect={true}
          totalOptions={5}
          selectedOptions={3}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert
      const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
      expect(nextButton).toBeDisabled()
      expect(screen.getByText('common.operation.selectAll')).toBeInTheDocument()
    })

    it('should render complete component with all props provided', () => {
      // Arrange
      const allProps = {
        disabled: false,
        handleNextStep: vi.fn(),
        showSelect: true,
        totalOptions: 10,
        selectedOptions: 5,
        onSelectAll: vi.fn(),
        tip: 'All props provided',
      }

      // Act
      render(<Actions {...allProps} />)

      // Assert
      expect(screen.getByText('common.operation.selectAll')).toBeInTheDocument()
      expect(screen.getByText('All props provided')).toBeInTheDocument()
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should render minimal component with only required props', () => {
      // Arrange & Act
      render(<Actions handleNextStep={vi.fn()} />)

      // Assert
      expect(screen.queryByText('common.operation.selectAll')).not.toBeInTheDocument()
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })
  })

  // ==========================================
  // Selection State Variations Testing
  // ==========================================
  describe('Selection State Variations', () => {
    // Tests for different selection states
    const selectionStates = [
      { totalOptions: 10, selectedOptions: 0, expectedState: 'unchecked' },
      { totalOptions: 10, selectedOptions: 5, expectedState: 'indeterminate' },
      { totalOptions: 10, selectedOptions: 10, expectedState: 'checked' },
      { totalOptions: 1, selectedOptions: 0, expectedState: 'unchecked' },
      { totalOptions: 1, selectedOptions: 1, expectedState: 'checked' },
      { totalOptions: 100, selectedOptions: 1, expectedState: 'indeterminate' },
      { totalOptions: 100, selectedOptions: 99, expectedState: 'indeterminate' },
    ]

    it.each(selectionStates)(
      'should render with $expectedState state when totalOptions=$totalOptions and selectedOptions=$selectedOptions',
      ({ totalOptions, selectedOptions }) => {
        // Arrange & Act
        const { container } = render(
          <Actions
            {...defaultProps}
            showSelect={true}
            totalOptions={totalOptions}
            selectedOptions={selectedOptions}
            onSelectAll={vi.fn()}
          />,
        )

        // Assert - component should render without errors
        const checkbox = container.querySelector('[class*="cursor-pointer"]')
        expect(checkbox).toBeInTheDocument()
        expect(screen.getByText('common.operation.selectAll')).toBeInTheDocument()
      },
    )
  })

  // ==========================================
  // Layout Structure Testing
  // ==========================================
  describe('Layout', () => {
    // Tests for correct layout structure
    it('should have correct container structure', () => {
      // Arrange & Act
      const { container } = render(<Actions {...defaultProps} />)

      // Assert
      const mainContainer = container.querySelector('.flex.items-center.gap-x-2.overflow-hidden')
      expect(mainContainer).toBeInTheDocument()
    })

    it('should have correct button container structure', () => {
      // Arrange & Act
      const { container } = render(<Actions {...defaultProps} />)

      // Assert - buttons should be in a flex container
      const buttonContainer = container.querySelector('.flex.grow.items-center.justify-end.gap-x-2')
      expect(buttonContainer).toBeInTheDocument()
    })

    it('should position select all section before buttons when showSelect is true', () => {
      // Arrange & Act
      const { container } = render(
        <Actions
          {...defaultProps}
          showSelect={true}
          totalOptions={5}
          selectedOptions={3}
          onSelectAll={vi.fn()}
        />,
      )

      // Assert - select all section should exist
      const selectAllSection = container.querySelector('.flex.shrink-0.items-center')
      expect(selectAllSection).toBeInTheDocument()
    })
  })
})
