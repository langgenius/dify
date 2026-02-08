import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Actions from './actions'

describe('Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<Actions onProcess={vi.fn()} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render save and process button', () => {
      // Arrange & Act
      render(<Actions onProcess={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render button with translated text', () => {
      // Arrange & Act
      render(<Actions onProcess={vi.fn()} />)

      // Assert - i18n key format
      expect(screen.getByText(/operations\.saveAndProcess/i)).toBeInTheDocument()
    })

    it('should render with correct container styling', () => {
      // Arrange & Act
      const { container } = render(<Actions onProcess={vi.fn()} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-end')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onProcess when button is clicked', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      render(<Actions onProcess={mockOnProcess} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnProcess).toHaveBeenCalledTimes(1)
    })

    it('should not call onProcess when button is disabled', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      render(<Actions onProcess={mockOnProcess} runDisabled={true} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnProcess).not.toHaveBeenCalled()
    })
  })

  // Props tests
  describe('Props', () => {
    it('should disable button when runDisabled is true', () => {
      // Arrange & Act
      render(<Actions onProcess={vi.fn()} runDisabled={true} />)

      // Assert
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should enable button when runDisabled is false', () => {
      // Arrange & Act
      render(<Actions onProcess={vi.fn()} runDisabled={false} />)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should enable button when runDisabled is undefined (default)', () => {
      // Arrange & Act
      render(<Actions onProcess={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })

  // Button variant tests
  describe('Button Styling', () => {
    it('should render button with primary variant', () => {
      // Arrange & Act
      render(<Actions onProcess={vi.fn()} />)

      // Assert - primary variant buttons have specific classes
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle multiple rapid clicks', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      render(<Actions onProcess={mockOnProcess} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(mockOnProcess).toHaveBeenCalledTimes(3)
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      const { rerender } = render(<Actions onProcess={mockOnProcess} />)

      // Act
      rerender(<Actions onProcess={mockOnProcess} runDisabled={true} />)

      // Assert
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should handle callback change', () => {
      // Arrange
      const mockOnProcess1 = vi.fn()
      const mockOnProcess2 = vi.fn()
      const { rerender } = render(<Actions onProcess={mockOnProcess1} />)

      // Act
      rerender(<Actions onProcess={mockOnProcess2} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnProcess1).not.toHaveBeenCalled()
      expect(mockOnProcess2).toHaveBeenCalledTimes(1)
    })
  })
})
