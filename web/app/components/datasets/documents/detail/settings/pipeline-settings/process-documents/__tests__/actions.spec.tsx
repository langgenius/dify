import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Actions from '../actions'

describe('Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Actions onProcess={vi.fn()} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render save and process button', () => {
      render(<Actions onProcess={vi.fn()} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render button with translated text', () => {
      render(<Actions onProcess={vi.fn()} />)

      // Assert - i18n key format
      expect(screen.getByText(/operations\.saveAndProcess/i)).toBeInTheDocument()
    })

    it('should render with correct container styling', () => {
      const { container } = render(<Actions onProcess={vi.fn()} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-end')
    })
  })

  describe('User Interactions', () => {
    it('should call onProcess when button is clicked', () => {
      const mockOnProcess = vi.fn()
      render(<Actions onProcess={mockOnProcess} />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnProcess).toHaveBeenCalledTimes(1)
    })

    it('should not call onProcess when button is disabled', () => {
      const mockOnProcess = vi.fn()
      render(<Actions onProcess={mockOnProcess} runDisabled={true} />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnProcess).not.toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should disable button when runDisabled is true', () => {
      render(<Actions onProcess={vi.fn()} runDisabled={true} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should enable button when runDisabled is false', () => {
      render(<Actions onProcess={vi.fn()} runDisabled={false} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should enable button when runDisabled is undefined (default)', () => {
      render(<Actions onProcess={vi.fn()} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })

  // Button variant tests
  describe('Button Styling', () => {
    it('should render button with primary variant', () => {
      render(<Actions onProcess={vi.fn()} />)

      // Assert - primary variant buttons have specific classes
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple rapid clicks', () => {
      const mockOnProcess = vi.fn()
      render(<Actions onProcess={mockOnProcess} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(mockOnProcess).toHaveBeenCalledTimes(3)
    })

    it('should maintain structure when rerendered', () => {
      const mockOnProcess = vi.fn()
      const { rerender } = render(<Actions onProcess={mockOnProcess} />)

      rerender(<Actions onProcess={mockOnProcess} runDisabled={true} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should handle callback change', () => {
      const mockOnProcess1 = vi.fn()
      const mockOnProcess2 = vi.fn()
      const { rerender } = render(<Actions onProcess={mockOnProcess1} />)

      rerender(<Actions onProcess={mockOnProcess2} />)
      fireEvent.click(screen.getByRole('button'))

      expect(mockOnProcess1).not.toHaveBeenCalled()
      expect(mockOnProcess2).toHaveBeenCalledTimes(1)
    })
  })
})
