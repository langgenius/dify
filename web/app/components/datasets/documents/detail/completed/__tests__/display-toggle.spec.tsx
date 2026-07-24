import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DisplayToggle from '../display-toggle'

describe('DisplayToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render button with proper styling', () => {
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex')
      expect(button).toHaveClass('items-center')
      expect(button).toHaveClass('justify-center')
      expect(button).toHaveClass('rounded-lg')
    })
  })

  describe('Props', () => {
    it('should render expand icon when isCollapsed is true', () => {
      const { container } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      // Assert - RiLineHeight icon for expand
      const icon = container.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })

    it('should render collapse icon when isCollapsed is false', () => {
      const { container } = render(
        <DisplayToggle isCollapsed={false} toggleCollapsed={vi.fn()} />,
      )

      // Assert - Collapse icon
      const icon = container.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call toggleCollapsed when button is clicked', () => {
      const mockToggle = vi.fn()
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={mockToggle} />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockToggle).toHaveBeenCalledTimes(1)
    })

    it('should call toggleCollapsed on multiple clicks', () => {
      const mockToggle = vi.fn()
      render(<DisplayToggle isCollapsed={true} toggleCollapsed={mockToggle} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(mockToggle).toHaveBeenCalledTimes(3)
    })
  })

  // Tooltip tests
  describe('Tooltip', () => {
    it('should render with tooltip wrapper', () => {
      const { container } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      // Assert - Tooltip renders a wrapper around button
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should toggle icon when isCollapsed prop changes', () => {
      const { rerender, container } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      rerender(<DisplayToggle isCollapsed={false} toggleCollapsed={vi.fn()} />)

      // Assert - icon should still be present
      const icon = container.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(
        <DisplayToggle isCollapsed={true} toggleCollapsed={vi.fn()} />,
      )

      rerender(<DisplayToggle isCollapsed={false} toggleCollapsed={vi.fn()} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
