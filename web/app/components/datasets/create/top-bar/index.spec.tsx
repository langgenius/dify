import type { TopBarProps } from './index'
import { render, screen } from '@testing-library/react'
import { TopBar } from './index'

// Mock next/link to capture href values
vi.mock('next/link', () => ({
  default: ({ children, href, replace, className }: { children: React.ReactNode, href: string, replace?: boolean, className?: string }) => (
    <a href={href} data-replace={replace} className={className} data-testid="back-link">
      {children}
    </a>
  ),
}))

// Helper to render TopBar with default props
const renderTopBar = (props: Partial<TopBarProps> = {}) => {
  const defaultProps: TopBarProps = {
    activeIndex: 0,
    ...props,
  }
  return {
    ...render(<TopBar {...defaultProps} />),
    props: defaultProps,
  }
}

// ============================================================================
// TopBar Component Tests
// ============================================================================
describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - Verify component renders properly
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderTopBar()

      // Assert
      expect(screen.getByTestId('back-link')).toBeInTheDocument()
    })

    it('should render back link with arrow icon', () => {
      // Arrange & Act
      const { container } = renderTopBar()

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toBeInTheDocument()
      // Check for the arrow icon (svg element)
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toBeInTheDocument()
    })

    it('should render fallback route text', () => {
      // Arrange & Act
      renderTopBar()

      // Assert
      expect(screen.getByText('datasetCreation.steps.header.fallbackRoute')).toBeInTheDocument()
    })

    it('should render Stepper component with 3 steps', () => {
      // Arrange & Act
      renderTopBar({ activeIndex: 0 })

      // Assert - Check for step translations
      expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.steps.two')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.steps.three')).toBeInTheDocument()
    })

    it('should apply default container classes', () => {
      // Arrange & Act
      const { container } = renderTopBar()

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative')
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('h-[52px]')
      expect(wrapper).toHaveClass('shrink-0')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-between')
      expect(wrapper).toHaveClass('border-b')
      expect(wrapper).toHaveClass('border-b-divider-subtle')
    })
  })

  // --------------------------------------------------------------------------
  // Props Testing - Test all prop variations
  // --------------------------------------------------------------------------
  describe('Props', () => {
    describe('className prop', () => {
      it('should apply custom className when provided', () => {
        // Arrange & Act
        const { container } = renderTopBar({ className: 'custom-class' })

        // Assert
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('custom-class')
      })

      it('should merge custom className with default classes', () => {
        // Arrange & Act
        const { container } = renderTopBar({ className: 'my-custom-class another-class' })

        // Assert
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('relative')
        expect(wrapper).toHaveClass('flex')
        expect(wrapper).toHaveClass('my-custom-class')
        expect(wrapper).toHaveClass('another-class')
      })

      it('should render correctly without className', () => {
        // Arrange & Act
        const { container } = renderTopBar({ className: undefined })

        // Assert
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('relative')
        expect(wrapper).toHaveClass('flex')
      })

      it('should handle empty string className', () => {
        // Arrange & Act
        const { container } = renderTopBar({ className: '' })

        // Assert
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('relative')
      })
    })

    describe('datasetId prop', () => {
      it('should set fallback route to /datasets when datasetId is undefined', () => {
        // Arrange & Act
        renderTopBar({ datasetId: undefined })

        // Assert
        const backLink = screen.getByTestId('back-link')
        expect(backLink).toHaveAttribute('href', '/datasets')
      })

      it('should set fallback route to /datasets/:id/documents when datasetId is provided', () => {
        // Arrange & Act
        renderTopBar({ datasetId: 'dataset-123' })

        // Assert
        const backLink = screen.getByTestId('back-link')
        expect(backLink).toHaveAttribute('href', '/datasets/dataset-123/documents')
      })

      it('should handle various datasetId formats', () => {
        // Arrange & Act
        renderTopBar({ datasetId: 'abc-def-ghi-123' })

        // Assert
        const backLink = screen.getByTestId('back-link')
        expect(backLink).toHaveAttribute('href', '/datasets/abc-def-ghi-123/documents')
      })

      it('should handle empty string datasetId', () => {
        // Arrange & Act
        renderTopBar({ datasetId: '' })

        // Assert - Empty string is falsy, so fallback to /datasets
        const backLink = screen.getByTestId('back-link')
        expect(backLink).toHaveAttribute('href', '/datasets')
      })
    })

    describe('activeIndex prop', () => {
      it('should pass activeIndex to Stepper component (index 0)', () => {
        // Arrange & Act
        const { container } = renderTopBar({ activeIndex: 0 })

        // Assert - First step should be active (has specific styling)
        const steps = container.querySelectorAll('[class*="system-2xs-semibold-uppercase"]')
        expect(steps.length).toBeGreaterThan(0)
      })

      it('should pass activeIndex to Stepper component (index 1)', () => {
        // Arrange & Act
        renderTopBar({ activeIndex: 1 })

        // Assert - Stepper is rendered with correct props
        expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
        expect(screen.getByText('datasetCreation.steps.two')).toBeInTheDocument()
      })

      it('should pass activeIndex to Stepper component (index 2)', () => {
        // Arrange & Act
        renderTopBar({ activeIndex: 2 })

        // Assert
        expect(screen.getByText('datasetCreation.steps.three')).toBeInTheDocument()
      })

      it('should handle edge case activeIndex of -1', () => {
        // Arrange & Act
        const { container } = renderTopBar({ activeIndex: -1 })

        // Assert - Component should render without crashing
        expect(container.firstChild).toBeInTheDocument()
      })

      it('should handle edge case activeIndex beyond steps length', () => {
        // Arrange & Act
        const { container } = renderTopBar({ activeIndex: 10 })

        // Assert - Component should render without crashing
        expect(container.firstChild).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests - Test useMemo logic and dependencies
  // --------------------------------------------------------------------------
  describe('Memoization Logic', () => {
    it('should compute fallbackRoute based on datasetId', () => {
      // Arrange & Act - With datasetId
      const { rerender } = render(<TopBar activeIndex={0} datasetId="test-id" />)

      // Assert
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets/test-id/documents')

      // Act - Rerender with different datasetId
      rerender(<TopBar activeIndex={0} datasetId="new-id" />)

      // Assert - Route should update
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets/new-id/documents')
    })

    it('should update fallbackRoute when datasetId changes from undefined to defined', () => {
      // Arrange
      const { rerender } = render(<TopBar activeIndex={0} />)
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets')

      // Act
      rerender(<TopBar activeIndex={0} datasetId="new-dataset" />)

      // Assert
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets/new-dataset/documents')
    })

    it('should update fallbackRoute when datasetId changes from defined to undefined', () => {
      // Arrange
      const { rerender } = render(<TopBar activeIndex={0} datasetId="existing-id" />)
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets/existing-id/documents')

      // Act
      rerender(<TopBar activeIndex={0} datasetId={undefined} />)

      // Assert
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets')
    })

    it('should not change fallbackRoute when activeIndex changes but datasetId stays same', () => {
      // Arrange
      const { rerender } = render(<TopBar activeIndex={0} datasetId="stable-id" />)
      const initialHref = screen.getByTestId('back-link').getAttribute('href')

      // Act
      rerender(<TopBar activeIndex={1} datasetId="stable-id" />)

      // Assert - href should remain the same
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', initialHref)
    })

    it('should not change fallbackRoute when className changes but datasetId stays same', () => {
      // Arrange
      const { rerender } = render(<TopBar activeIndex={0} datasetId="stable-id" className="class-1" />)
      const initialHref = screen.getByTestId('back-link').getAttribute('href')

      // Act
      rerender(<TopBar activeIndex={0} datasetId="stable-id" className="class-2" />)

      // Assert - href should remain the same
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', initialHref)
    })
  })

  // --------------------------------------------------------------------------
  // Link Component Tests
  // --------------------------------------------------------------------------
  describe('Link Component', () => {
    it('should render Link with replace prop', () => {
      // Arrange & Act
      renderTopBar()

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toHaveAttribute('data-replace', 'true')
    })

    it('should render Link with correct classes', () => {
      // Arrange & Act
      renderTopBar()

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toHaveClass('inline-flex')
      expect(backLink).toHaveClass('h-12')
      expect(backLink).toHaveClass('items-center')
      expect(backLink).toHaveClass('justify-start')
      expect(backLink).toHaveClass('gap-1')
      expect(backLink).toHaveClass('py-2')
      expect(backLink).toHaveClass('pl-2')
      expect(backLink).toHaveClass('pr-6')
    })
  })

  // --------------------------------------------------------------------------
  // STEP_T_MAP Tests - Verify step translations
  // --------------------------------------------------------------------------
  describe('STEP_T_MAP Translations', () => {
    it('should render step one translation', () => {
      // Arrange & Act
      renderTopBar({ activeIndex: 0 })

      // Assert
      expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
    })

    it('should render step two translation', () => {
      // Arrange & Act
      renderTopBar({ activeIndex: 1 })

      // Assert
      expect(screen.getByText('datasetCreation.steps.two')).toBeInTheDocument()
    })

    it('should render step three translation', () => {
      // Arrange & Act
      renderTopBar({ activeIndex: 2 })

      // Assert
      expect(screen.getByText('datasetCreation.steps.three')).toBeInTheDocument()
    })

    it('should render all three step translations', () => {
      // Arrange & Act
      renderTopBar({ activeIndex: 0 })

      // Assert
      expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.steps.two')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.steps.three')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases and Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle special characters in datasetId', () => {
      // Arrange & Act
      renderTopBar({ datasetId: 'dataset-with-special_chars.123' })

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toHaveAttribute('href', '/datasets/dataset-with-special_chars.123/documents')
    })

    it('should handle very long datasetId', () => {
      // Arrange
      const longId = 'a'.repeat(100)

      // Act
      renderTopBar({ datasetId: longId })

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toHaveAttribute('href', `/datasets/${longId}/documents`)
    })

    it('should handle UUID format datasetId', () => {
      // Arrange
      const uuid = '550e8400-e29b-41d4-a716-446655440000'

      // Act
      renderTopBar({ datasetId: uuid })

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toHaveAttribute('href', `/datasets/${uuid}/documents`)
    })

    it('should handle whitespace in className', () => {
      // Arrange & Act
      const { container } = renderTopBar({ className: '  spaced-class  ' })

      // Assert - classNames utility handles whitespace
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toBeInTheDocument()
    })

    it('should render correctly with all props provided', () => {
      // Arrange & Act
      const { container } = renderTopBar({
        className: 'custom-class',
        datasetId: 'full-props-id',
        activeIndex: 2,
      })

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets/full-props-id/documents')
    })

    it('should render correctly with minimal props (only activeIndex)', () => {
      // Arrange & Act
      const { container } = renderTopBar({ activeIndex: 0 })

      // Assert
      expect(container.firstChild).toBeInTheDocument()
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets')
    })
  })

  // --------------------------------------------------------------------------
  // Stepper Integration Tests
  // --------------------------------------------------------------------------
  describe('Stepper Integration', () => {
    it('should pass steps array with correct structure to Stepper', () => {
      // Arrange & Act
      renderTopBar({ activeIndex: 0 })

      // Assert - All step names should be rendered
      const stepOne = screen.getByText('datasetCreation.steps.one')
      const stepTwo = screen.getByText('datasetCreation.steps.two')
      const stepThree = screen.getByText('datasetCreation.steps.three')

      expect(stepOne).toBeInTheDocument()
      expect(stepTwo).toBeInTheDocument()
      expect(stepThree).toBeInTheDocument()
    })

    it('should render Stepper in centered position', () => {
      // Arrange & Act
      const { container } = renderTopBar({ activeIndex: 0 })

      // Assert - Check for centered positioning classes
      const centeredContainer = container.querySelector('.absolute.left-1\\/2.top-1\\/2.-translate-x-1\\/2.-translate-y-1\\/2')
      expect(centeredContainer).toBeInTheDocument()
    })

    it('should render step dividers between steps', () => {
      // Arrange & Act
      const { container } = renderTopBar({ activeIndex: 0 })

      // Assert - Check for dividers (h-px w-4 bg-divider-deep)
      const dividers = container.querySelectorAll('.h-px.w-4.bg-divider-deep')
      expect(dividers.length).toBe(2) // 2 dividers between 3 steps
    })
  })

  // --------------------------------------------------------------------------
  // Accessibility Tests
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have accessible back link', () => {
      // Arrange & Act
      renderTopBar()

      // Assert
      const backLink = screen.getByTestId('back-link')
      expect(backLink).toBeInTheDocument()
      // Link should have visible text
      expect(screen.getByText('datasetCreation.steps.header.fallbackRoute')).toBeInTheDocument()
    })

    it('should have visible arrow icon in back link', () => {
      // Arrange & Act
      const { container } = renderTopBar()

      // Assert - Arrow icon should be visible
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toBeInTheDocument()
      expect(arrowIcon).toHaveClass('text-text-primary')
    })
  })

  // --------------------------------------------------------------------------
  // Re-render Tests
  // --------------------------------------------------------------------------
  describe('Re-render Behavior', () => {
    it('should update activeIndex on re-render', () => {
      // Arrange
      const { rerender, container } = render(<TopBar activeIndex={0} />)

      // Initial check
      expect(container.firstChild).toBeInTheDocument()

      // Act - Update activeIndex
      rerender(<TopBar activeIndex={1} />)

      // Assert - Component should still render
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should update className on re-render', () => {
      // Arrange
      const { rerender, container } = render(<TopBar activeIndex={0} className="initial-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('initial-class')

      // Act
      rerender(<TopBar activeIndex={0} className="updated-class" />)

      // Assert
      expect(wrapper).toHaveClass('updated-class')
      expect(wrapper).not.toHaveClass('initial-class')
    })

    it('should handle multiple rapid re-renders', () => {
      // Arrange
      const { rerender, container } = render(<TopBar activeIndex={0} />)

      // Act - Multiple rapid re-renders
      rerender(<TopBar activeIndex={1} />)
      rerender(<TopBar activeIndex={2} />)
      rerender(<TopBar activeIndex={0} datasetId="new-id" />)
      rerender(<TopBar activeIndex={1} datasetId="another-id" className="new-class" />)

      // Assert - Component should be stable
      expect(container.firstChild).toBeInTheDocument()
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('new-class')
      expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/datasets/another-id/documents')
    })
  })
})
