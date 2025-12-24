import type { StepperProps } from './index'
import type { Step, StepperStepProps } from './step'
import { render, screen } from '@testing-library/react'
import { Stepper } from './index'
import { StepperStep } from './step'

// Test data factory for creating steps
const createStep = (overrides: Partial<Step> = {}): Step => ({
  name: 'Test Step',
  ...overrides,
})

const createSteps = (count: number, namePrefix = 'Step'): Step[] =>
  Array.from({ length: count }, (_, i) => createStep({ name: `${namePrefix} ${i + 1}` }))

// Helper to render Stepper with default props
const renderStepper = (props: Partial<StepperProps> = {}) => {
  const defaultProps: StepperProps = {
    steps: createSteps(3),
    activeIndex: 0,
    ...props,
  }
  return render(<Stepper {...defaultProps} />)
}

// Helper to render StepperStep with default props
const renderStepperStep = (props: Partial<StepperStepProps> = {}) => {
  const defaultProps: StepperStepProps = {
    name: 'Test Step',
    index: 0,
    activeIndex: 0,
    ...props,
  }
  return render(<StepperStep {...defaultProps} />)
}

// ============================================================================
// Stepper Component Tests
// ============================================================================
describe('Stepper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - Verify component renders properly with various inputs
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderStepper()

      // Assert
      expect(screen.getByText('Step 1')).toBeInTheDocument()
    })

    it('should render all step names', () => {
      // Arrange
      const steps = createSteps(3, 'Custom Step')

      // Act
      renderStepper({ steps })

      // Assert
      expect(screen.getByText('Custom Step 1')).toBeInTheDocument()
      expect(screen.getByText('Custom Step 2')).toBeInTheDocument()
      expect(screen.getByText('Custom Step 3')).toBeInTheDocument()
    })

    it('should render dividers between steps', () => {
      // Arrange
      const steps = createSteps(3)

      // Act
      const { container } = renderStepper({ steps })

      // Assert - Should have 2 dividers for 3 steps
      const dividers = container.querySelectorAll('.bg-divider-deep')
      expect(dividers.length).toBe(2)
    })

    it('should not render divider after last step', () => {
      // Arrange
      const steps = createSteps(2)

      // Act
      const { container } = renderStepper({ steps })

      // Assert - Should have 1 divider for 2 steps
      const dividers = container.querySelectorAll('.bg-divider-deep')
      expect(dividers.length).toBe(1)
    })

    it('should render with flex container layout', () => {
      // Arrange & Act
      const { container } = renderStepper()

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'items-center', 'gap-3')
    })
  })

  // --------------------------------------------------------------------------
  // Props Testing - Test all prop variations and combinations
  // --------------------------------------------------------------------------
  describe('Props', () => {
    describe('steps prop', () => {
      it('should render correct number of steps', () => {
        // Arrange
        const steps = createSteps(5)

        // Act
        renderStepper({ steps })

        // Assert
        expect(screen.getByText('Step 1')).toBeInTheDocument()
        expect(screen.getByText('Step 2')).toBeInTheDocument()
        expect(screen.getByText('Step 3')).toBeInTheDocument()
        expect(screen.getByText('Step 4')).toBeInTheDocument()
        expect(screen.getByText('Step 5')).toBeInTheDocument()
      })

      it('should handle single step correctly', () => {
        // Arrange
        const steps = [createStep({ name: 'Only Step' })]

        // Act
        const { container } = renderStepper({ steps, activeIndex: 0 })

        // Assert
        expect(screen.getByText('Only Step')).toBeInTheDocument()
        // No dividers for single step
        const dividers = container.querySelectorAll('.bg-divider-deep')
        expect(dividers.length).toBe(0)
      })

      it('should handle steps with long names', () => {
        // Arrange
        const longName = 'This is a very long step name that might overflow'
        const steps = [createStep({ name: longName })]

        // Act
        renderStepper({ steps, activeIndex: 0 })

        // Assert
        expect(screen.getByText(longName)).toBeInTheDocument()
      })

      it('should handle steps with special characters', () => {
        // Arrange
        const steps = [
          createStep({ name: 'Step & Configuration' }),
          createStep({ name: 'Step <Preview>' }),
          createStep({ name: 'Step "Complete"' }),
        ]

        // Act
        renderStepper({ steps, activeIndex: 0 })

        // Assert
        expect(screen.getByText('Step & Configuration')).toBeInTheDocument()
        expect(screen.getByText('Step <Preview>')).toBeInTheDocument()
        expect(screen.getByText('Step "Complete"')).toBeInTheDocument()
      })
    })

    describe('activeIndex prop', () => {
      it('should highlight first step when activeIndex is 0', () => {
        // Arrange & Act
        renderStepper({ activeIndex: 0 })

        // Assert - First step should show "STEP 1" label
        expect(screen.getByText('STEP 1')).toBeInTheDocument()
      })

      it('should highlight second step when activeIndex is 1', () => {
        // Arrange & Act
        renderStepper({ activeIndex: 1 })

        // Assert - Second step should show "STEP 2" label
        expect(screen.getByText('STEP 2')).toBeInTheDocument()
      })

      it('should highlight last step when activeIndex equals steps length - 1', () => {
        // Arrange
        const steps = createSteps(3)

        // Act
        renderStepper({ steps, activeIndex: 2 })

        // Assert - Third step should show "STEP 3" label
        expect(screen.getByText('STEP 3')).toBeInTheDocument()
      })

      it('should show completed steps with number only (no STEP prefix)', () => {
        // Arrange
        const steps = createSteps(3)

        // Act
        renderStepper({ steps, activeIndex: 2 })

        // Assert - Completed steps show just the number
        expect(screen.getByText('1')).toBeInTheDocument()
        expect(screen.getByText('2')).toBeInTheDocument()
        expect(screen.getByText('STEP 3')).toBeInTheDocument()
      })

      it('should show disabled steps with number only (no STEP prefix)', () => {
        // Arrange
        const steps = createSteps(3)

        // Act
        renderStepper({ steps, activeIndex: 0 })

        // Assert - Disabled steps show just the number
        expect(screen.getByText('STEP 1')).toBeInTheDocument()
        expect(screen.getByText('2')).toBeInTheDocument()
        expect(screen.getByText('3')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases - Test boundary conditions and unexpected inputs
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty steps array', () => {
      // Arrange & Act
      const { container } = renderStepper({ steps: [] })

      // Assert - Container should render but be empty
      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle activeIndex greater than steps length', () => {
      // Arrange
      const steps = createSteps(2)

      // Act - activeIndex 5 is beyond array bounds
      renderStepper({ steps, activeIndex: 5 })

      // Assert - All steps should render as completed (since activeIndex > all indices)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should handle negative activeIndex', () => {
      // Arrange
      const steps = createSteps(2)

      // Act - negative activeIndex
      renderStepper({ steps, activeIndex: -1 })

      // Assert - All steps should render as disabled (since activeIndex < all indices)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should handle large number of steps', () => {
      // Arrange
      const steps = createSteps(10)

      // Act
      const { container } = renderStepper({ steps, activeIndex: 5 })

      // Assert
      expect(screen.getByText('STEP 6')).toBeInTheDocument()
      // Should have 9 dividers for 10 steps
      const dividers = container.querySelectorAll('.bg-divider-deep')
      expect(dividers.length).toBe(9)
    })

    it('should handle steps with empty name', () => {
      // Arrange
      const steps = [createStep({ name: '' })]

      // Act
      const { container } = renderStepper({ steps, activeIndex: 0 })

      // Assert - Should still render the step structure
      expect(screen.getByText('STEP 1')).toBeInTheDocument()
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Integration - Test step state combinations
  // --------------------------------------------------------------------------
  describe('Step States', () => {
    it('should render mixed states: completed, active, disabled', () => {
      // Arrange
      const steps = createSteps(5)

      // Act
      renderStepper({ steps, activeIndex: 2 })

      // Assert
      // Steps 1-2 are completed (show number only)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      // Step 3 is active (shows STEP prefix)
      expect(screen.getByText('STEP 3')).toBeInTheDocument()
      // Steps 4-5 are disabled (show number only)
      expect(screen.getByText('4')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should transition through all states correctly', () => {
      // Arrange
      const steps = createSteps(3)

      // Act & Assert - Step 1 active
      const { rerender } = render(<Stepper steps={steps} activeIndex={0} />)
      expect(screen.getByText('STEP 1')).toBeInTheDocument()

      // Step 2 active
      rerender(<Stepper steps={steps} activeIndex={1} />)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('STEP 2')).toBeInTheDocument()

      // Step 3 active
      rerender(<Stepper steps={steps} activeIndex={2} />)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('STEP 3')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// StepperStep Component Tests
// ============================================================================
describe('StepperStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderStepperStep()

      // Assert
      expect(screen.getByText('Test Step')).toBeInTheDocument()
    })

    it('should render step name', () => {
      // Arrange & Act
      renderStepperStep({ name: 'Configure Dataset' })

      // Assert
      expect(screen.getByText('Configure Dataset')).toBeInTheDocument()
    })

    it('should render with flex container layout', () => {
      // Arrange & Act
      const { container } = renderStepperStep()

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'items-center', 'gap-2')
    })
  })

  // --------------------------------------------------------------------------
  // Active State Tests
  // --------------------------------------------------------------------------
  describe('Active State', () => {
    it('should show STEP prefix when active', () => {
      // Arrange & Act
      renderStepperStep({ index: 0, activeIndex: 0 })

      // Assert
      expect(screen.getByText('STEP 1')).toBeInTheDocument()
    })

    it('should apply active styles to label container', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 0, activeIndex: 0 })

      // Assert
      const labelContainer = container.querySelector('.bg-state-accent-solid')
      expect(labelContainer).toBeInTheDocument()
      expect(labelContainer).toHaveClass('px-2')
    })

    it('should apply active text color to label', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 0, activeIndex: 0 })

      // Assert
      const label = container.querySelector('.text-text-primary-on-surface')
      expect(label).toBeInTheDocument()
    })

    it('should apply accent text color to name when active', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 0, activeIndex: 0 })

      // Assert
      const nameElement = container.querySelector('.text-text-accent')
      expect(nameElement).toBeInTheDocument()
      expect(nameElement).toHaveClass('system-xs-semibold-uppercase')
    })

    it('should calculate active correctly for different indices', () => {
      // Test index 1 with activeIndex 1
      const { rerender } = render(
        <StepperStep name="Step" index={1} activeIndex={1} />,
      )
      expect(screen.getByText('STEP 2')).toBeInTheDocument()

      // Test index 5 with activeIndex 5
      rerender(<StepperStep name="Step" index={5} activeIndex={5} />)
      expect(screen.getByText('STEP 6')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Completed State Tests (index < activeIndex)
  // --------------------------------------------------------------------------
  describe('Completed State', () => {
    it('should show number only when completed (not active)', () => {
      // Arrange & Act
      renderStepperStep({ index: 0, activeIndex: 1 })

      // Assert
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.queryByText('STEP 1')).not.toBeInTheDocument()
    })

    it('should apply completed styles to label container', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 0, activeIndex: 1 })

      // Assert
      const labelContainer = container.querySelector('.border-text-quaternary')
      expect(labelContainer).toBeInTheDocument()
      expect(labelContainer).toHaveClass('w-5')
    })

    it('should apply tertiary text color to label when completed', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 0, activeIndex: 1 })

      // Assert
      const label = container.querySelector('.text-text-tertiary')
      expect(label).toBeInTheDocument()
    })

    it('should apply tertiary text color to name when completed', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 0, activeIndex: 2 })

      // Assert
      const nameElements = container.querySelectorAll('.text-text-tertiary')
      expect(nameElements.length).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // Disabled State Tests (index > activeIndex)
  // --------------------------------------------------------------------------
  describe('Disabled State', () => {
    it('should show number only when disabled', () => {
      // Arrange & Act
      renderStepperStep({ index: 2, activeIndex: 0 })

      // Assert
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.queryByText('STEP 3')).not.toBeInTheDocument()
    })

    it('should apply disabled styles to label container', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 2, activeIndex: 0 })

      // Assert
      const labelContainer = container.querySelector('.border-divider-deep')
      expect(labelContainer).toBeInTheDocument()
      expect(labelContainer).toHaveClass('w-5')
    })

    it('should apply quaternary text color to label when disabled', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 2, activeIndex: 0 })

      // Assert
      const label = container.querySelector('.text-text-quaternary')
      expect(label).toBeInTheDocument()
    })

    it('should apply quaternary text color to name when disabled', () => {
      // Arrange & Act
      const { container } = renderStepperStep({ index: 2, activeIndex: 0 })

      // Assert
      const nameElements = container.querySelectorAll('.text-text-quaternary')
      expect(nameElements.length).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // Props Testing
  // --------------------------------------------------------------------------
  describe('Props', () => {
    describe('name prop', () => {
      it('should render provided name', () => {
        // Arrange & Act
        renderStepperStep({ name: 'Custom Name' })

        // Assert
        expect(screen.getByText('Custom Name')).toBeInTheDocument()
      })

      it('should handle empty name', () => {
        // Arrange & Act
        const { container } = renderStepperStep({ name: '' })

        // Assert - Label should still render
        expect(screen.getByText('STEP 1')).toBeInTheDocument()
        expect(container.firstChild).toBeInTheDocument()
      })

      it('should handle name with whitespace', () => {
        // Arrange & Act
        renderStepperStep({ name: '  Padded Name  ' })

        // Assert
        expect(screen.getByText('Padded Name')).toBeInTheDocument()
      })
    })

    describe('index prop', () => {
      it('should display correct 1-based number for index 0', () => {
        // Arrange & Act
        renderStepperStep({ index: 0, activeIndex: 0 })

        // Assert
        expect(screen.getByText('STEP 1')).toBeInTheDocument()
      })

      it('should display correct 1-based number for index 9', () => {
        // Arrange & Act
        renderStepperStep({ index: 9, activeIndex: 9 })

        // Assert
        expect(screen.getByText('STEP 10')).toBeInTheDocument()
      })

      it('should handle large index values', () => {
        // Arrange & Act
        renderStepperStep({ index: 99, activeIndex: 99 })

        // Assert
        expect(screen.getByText('STEP 100')).toBeInTheDocument()
      })
    })

    describe('activeIndex prop', () => {
      it('should determine state based on activeIndex comparison', () => {
        // Active: index === activeIndex
        const { rerender } = render(
          <StepperStep name="Step" index={1} activeIndex={1} />,
        )
        expect(screen.getByText('STEP 2')).toBeInTheDocument()

        // Completed: index < activeIndex
        rerender(<StepperStep name="Step" index={1} activeIndex={2} />)
        expect(screen.getByText('2')).toBeInTheDocument()

        // Disabled: index > activeIndex
        rerender(<StepperStep name="Step" index={1} activeIndex={0} />)
        expect(screen.getByText('2')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle zero index correctly', () => {
      // Arrange & Act
      renderStepperStep({ index: 0, activeIndex: 0 })

      // Assert
      expect(screen.getByText('STEP 1')).toBeInTheDocument()
    })

    it('should handle negative activeIndex', () => {
      // Arrange & Act
      renderStepperStep({ index: 0, activeIndex: -1 })

      // Assert - Step should be disabled (index > activeIndex)
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should handle equal boundary (index equals activeIndex)', () => {
      // Arrange & Act
      renderStepperStep({ index: 5, activeIndex: 5 })

      // Assert - Should be active
      expect(screen.getByText('STEP 6')).toBeInTheDocument()
    })

    it('should handle name with HTML-like content safely', () => {
      // Arrange & Act
      renderStepperStep({ name: '<script>alert("xss")</script>' })

      // Assert - Should render as text, not execute
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
    })

    it('should handle name with unicode characters', () => {
      // Arrange & Act
      renderStepperStep({ name: 'Step 数据 🚀' })

      // Assert
      expect(screen.getByText('Step 数据 🚀')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Style Classes Verification
  // --------------------------------------------------------------------------
  describe('Style Classes', () => {
    it('should apply correct typography classes to label', () => {
      // Arrange & Act
      const { container } = renderStepperStep()

      // Assert
      const label = container.querySelector('.system-2xs-semibold-uppercase')
      expect(label).toBeInTheDocument()
    })

    it('should apply correct typography classes to name', () => {
      // Arrange & Act
      const { container } = renderStepperStep()

      // Assert
      const name = container.querySelector('.system-xs-medium-uppercase')
      expect(name).toBeInTheDocument()
    })

    it('should have rounded pill shape for label container', () => {
      // Arrange & Act
      const { container } = renderStepperStep()

      // Assert
      const labelContainer = container.querySelector('.rounded-3xl')
      expect(labelContainer).toBeInTheDocument()
    })

    it('should apply h-5 height to label container', () => {
      // Arrange & Act
      const { container } = renderStepperStep()

      // Assert
      const labelContainer = container.querySelector('.h-5')
      expect(labelContainer).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests - Stepper and StepperStep working together
// ============================================================================
describe('Stepper Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass correct props to each StepperStep', () => {
    // Arrange
    const steps = [
      createStep({ name: 'First' }),
      createStep({ name: 'Second' }),
      createStep({ name: 'Third' }),
    ]

    // Act
    renderStepper({ steps, activeIndex: 1 })

    // Assert - Each step receives correct index and displays correctly
    expect(screen.getByText('1')).toBeInTheDocument() // Completed
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('STEP 2')).toBeInTheDocument() // Active
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument() // Disabled
    expect(screen.getByText('Third')).toBeInTheDocument()
  })

  it('should maintain correct visual hierarchy across steps', () => {
    // Arrange
    const steps = createSteps(4)

    // Act
    const { container } = renderStepper({ steps, activeIndex: 2 })

    // Assert - Check visual hierarchy
    // Completed steps (0, 1) have border-text-quaternary
    const completedLabels = container.querySelectorAll('.border-text-quaternary')
    expect(completedLabels.length).toBe(2)

    // Active step has bg-state-accent-solid
    const activeLabel = container.querySelector('.bg-state-accent-solid')
    expect(activeLabel).toBeInTheDocument()

    // Disabled step (3) has border-divider-deep
    const disabledLabels = container.querySelectorAll('.border-divider-deep')
    expect(disabledLabels.length).toBe(1)
  })

  it('should render correctly with dynamic step updates', () => {
    // Arrange
    const initialSteps = createSteps(2)

    // Act
    const { rerender } = render(<Stepper steps={initialSteps} activeIndex={0} />)
    expect(screen.getByText('Step 1')).toBeInTheDocument()
    expect(screen.getByText('Step 2')).toBeInTheDocument()

    // Update with more steps
    const updatedSteps = createSteps(4)
    rerender(<Stepper steps={updatedSteps} activeIndex={2} />)

    // Assert
    expect(screen.getByText('STEP 3')).toBeInTheDocument()
    expect(screen.getByText('Step 4')).toBeInTheDocument()
  })
})
