import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddAnother from '../add-another'

describe('AddAnother', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the checkbox', () => {
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert - Checkbox component renders with shrink-0 class
      const checkbox = container.querySelector('.shrink-0')
      expect(checkbox).toBeInTheDocument()
    })

    it('should render the add another text', () => {
      render(<AddAnother isChecked={false} onCheck={vi.fn()} />)

      // Assert - i18n key format
      expect(screen.getByText(/segment\.addAnother/i)).toBeInTheDocument()
    })

    it('should render with correct base styling classes', () => {
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('gap-x-1')
      expect(wrapper).toHaveClass('pl-1')
    })
  })

  describe('Props', () => {
    it('should render unchecked state when isChecked is false', () => {
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      // Assert - unchecked checkbox has border class
      const checkbox = container.querySelector('.border-components-checkbox-border')
      expect(checkbox).toBeInTheDocument()
    })

    it('should render checked state when isChecked is true', () => {
      const { container } = render(
        <AddAnother isChecked={true} onCheck={vi.fn()} />,
      )

      // Assert - checked checkbox has bg-components-checkbox-bg class
      const checkbox = container.querySelector('.bg-components-checkbox-bg')
      expect(checkbox).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(
        <AddAnother
          isChecked={false}
          onCheck={vi.fn()}
          className="custom-class"
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  describe('User Interactions', () => {
    it('should call onCheck when checkbox is clicked', () => {
      const mockOnCheck = vi.fn()
      const { container } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      // Act - click on the checkbox element
      const checkbox = container.querySelector('.shrink-0')
      if (checkbox)
        fireEvent.click(checkbox)

      expect(mockOnCheck).toHaveBeenCalledTimes(1)
    })

    it('should toggle checked state on multiple clicks', () => {
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

      expect(mockOnCheck).toHaveBeenCalledTimes(2)
    })
  })

  describe('Structure', () => {
    it('should render text with tertiary text color', () => {
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      const textElement = container.querySelector('.text-text-tertiary')
      expect(textElement).toBeInTheDocument()
    })

    it('should render text with xs medium font styling', () => {
      const { container } = render(
        <AddAnother isChecked={false} onCheck={vi.fn()} />,
      )

      const textElement = container.querySelector('.system-xs-medium')
      expect(textElement).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      const mockOnCheck = vi.fn()
      const { rerender, container } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      rerender(<AddAnother isChecked={true} onCheck={mockOnCheck} />)

      const checkbox = container.querySelector('.shrink-0')
      expect(checkbox).toBeInTheDocument()
    })

    it('should handle rapid state changes', () => {
      const mockOnCheck = vi.fn()
      const { container } = render(
        <AddAnother isChecked={false} onCheck={mockOnCheck} />,
      )

      const checkbox = container.querySelector('.shrink-0')
      if (checkbox) {
        for (let i = 0; i < 5; i++)
          fireEvent.click(checkbox)
      }

      expect(mockOnCheck).toHaveBeenCalledTimes(5)
    })
  })
})
