import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddAnother from './add-another'

describe('AddAnother', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the checkbox', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert - Checkbox component renders with shrink-0 class
      const checkbox = container.querySelector('.shrink-0')
      expect(checkbox).toBeInTheDocument()
    })

    it('should render the add another text', () => {
      // Arrange & Act
      render(<AddAnother isChecked={false} onCheck={vi.fn()} />)

      // Assert - i18n key format
      expect(screen.getByText(/segment\.addAnother/i)).toBeInTheDocument()
    })

    it('should render with correct base styling classes', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('gap-x-1')
      expect(wrapper).toHaveClass('pl-1')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should render unchecked state when isChecked is false', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert - unchecked checkbox has border class
      const checkbox = container.querySelector('.border-components-checkbox-border')
      expect(checkbox).toBeInTheDocument()
    })

    it('should render checked state when isChecked is true', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={true} onCheck={vi.fn()} />,
      )

      // Assert - checked checkbox has bg-components-checkbox-bg class
      const checkbox = container.querySelector('.bg-components-checkbox-bg')
      expect(checkbox).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother
          isChecked={false}
          onCheck={vi.fn()}
          className="custom-class"
        />,
      )

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onCheck when checkbox is clicked', () => {
      // Arrange
      const mockOnCheck = vi.fn()
      const { container } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      // Act - click on the checkbox element
      const checkbox = container.querySelector('.shrink-0')
      if (checkbox)
        fireEvent.click(checkbox)

      // Assert
      expect(mockOnCheck).toHaveBeenCalledTimes(1)
    })

    it('should toggle checked state on multiple clicks', () => {
      // Arrange
      const mockOnCheck = vi.fn()
      const { container, rerender } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      // Act - first click
      const checkbox = container.querySelector('.shrink-0')
      if (checkbox) {
        fireEvent.click(checkbox)
        rerender(<AddAnother isChecked={true} onCheck={mockOnCheck} />)
        fireEvent.click(checkbox)
      }

      // Assert
      expect(mockOnCheck).toHaveBeenCalledTimes(2)
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render text with tertiary text color', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert
      const textElement = container.querySelector('.text-text-tertiary')
      expect(textElement).toBeInTheDocument()
    })

    it('should render text with xs medium font styling', () => {
      // Arrange & Act
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert
      const textElement = container.querySelector('.system-xs-medium')
      expect(textElement).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      // Arrange
      const mockOnCheck = vi.fn()
      const { rerender, container } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      // Act
      rerender(<AddAnother isChecked={true} onCheck={mockOnCheck} />)

      // Assert
      const checkbox = container.querySelector('.shrink-0')
      expect(checkbox).toBeInTheDocument()
    })

    it('should handle rapid state changes', () => {
      // Arrange
      const mockOnCheck = vi.fn()
      const { container } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      // Act
      const checkbox = container.querySelector('.shrink-0')
      if (checkbox) {
        for (let i = 0; i < 5; i++)
          fireEvent.click(checkbox)
      }

      // Assert
      expect(mockOnCheck).toHaveBeenCalledTimes(5)
    })
  })
})
