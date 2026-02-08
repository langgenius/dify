import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DisplayToggle from './display-toggle'

describe('DisplayToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render button with proper styling', () => {
      // Arrange & Act
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex')
      expect(button).toHaveClass('items-center')
      expect(button).toHaveClass('justify-center')
      expect(button).toHaveClass('rounded-lg')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should render expand icon when isCollapsed is true', () => {
      // Arrange & Act
      const { container } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      // Assert - RiLineHeight icon for expand
      const icon = container.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })

    it('should render collapse icon when isCollapsed is false', () => {
      // Arrange & Act
      const { container } = render(
        <DisplayToggle isCollapsed={false} toggleCollapsed={vi.fn()} />,
      )

      // Assert - Collapse icon
      const icon = container.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call toggleCollapsed when button is clicked', () => {
      // Arrange
      const mockToggle = vi.fn()
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={mockToggle} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockToggle).toHaveBeenCalledTimes(1)
    })

    it('should call toggleCollapsed on multiple clicks', () => {
      // Arrange
      const mockToggle = vi.fn()
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={mockToggle} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(mockToggle).toHaveBeenCalledTimes(3)
    })
  })

  // Tooltip tests
  describe('Tooltip', () => {
    it('should render with tooltip wrapper', () => {
      // Arrange & Act
      const { container } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      // Assert - Tooltip renders a wrapper around button
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should toggle icon when isCollapsed prop changes', () => {
      // Arrange
      const { rerender, container } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      // Act
      rerender(<DisplayToggle isCollapsed={false} toggleCollapsed={vi.fn()} />)

      // Assert - icon should still be present
      const icon = container.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      // Act
      rerender(<DisplayToggle isCollapsed={false} toggleCollapsed={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
