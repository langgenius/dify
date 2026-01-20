import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitterContextProvider } from '@/context/event-emitter'
import RegenerationModal from './regeneration-modal'

// Create a wrapper component with event emitter context
const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <EventEmitterContextProvider>
      {children}
    </EventEmitterContextProvider>
  )
}

describe('RegenerationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    isShow: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onClose: vi.fn(),
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing when isShow is true', () => {
      // Arrange & Act
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Assert
      expect(screen.getByText(/segment\.regenerationConfirmTitle/i)).toBeInTheDocument()
    })

    it('should not render content when isShow is false', () => {
      // Arrange & Act
      render(<RegenerationModal {...defaultProps} isShow={false} />, { wrapper: createWrapper() })

      // Assert - Modal container might exist but content should not be visible
      expect(screen.queryByText(/segment\.regenerationConfirmTitle/i)).not.toBeInTheDocument()
    })

    it('should render confirmation message', () => {
      // Arrange & Act
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Assert
      expect(screen.getByText(/segment\.regenerationConfirmMessage/i)).toBeInTheDocument()
    })

    it('should render cancel button in default state', () => {
      // Arrange & Act
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Assert
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
    })

    it('should render regenerate button in default state', () => {
      // Arrange & Act
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Assert
      expect(screen.getByText(/operation\.regenerate/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      render(<RegenerationModal {...defaultProps} onCancel={mockOnCancel} />, { wrapper: createWrapper() })

      // Act
      fireEvent.click(screen.getByText(/operation\.cancel/i))

      // Assert
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm when regenerate button is clicked', () => {
      // Arrange
      const mockOnConfirm = vi.fn()
      render(<RegenerationModal {...defaultProps} onConfirm={mockOnConfirm} />, { wrapper: createWrapper() })

      // Act
      fireEvent.click(screen.getByText(/operation\.regenerate/i))

      // Assert
      expect(mockOnConfirm).toHaveBeenCalledTimes(1)
    })
  })

  // Modal content states - these would require event emitter manipulation
  describe('Modal States', () => {
    it('should show default content initially', () => {
      // Arrange & Act
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Assert
      expect(screen.getByText(/segment\.regenerationConfirmTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle toggling isShow prop', () => {
      // Arrange
      const { rerender } = render(
        <RegenerationModal {...defaultProps} isShow={true} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText(/segment\.regenerationConfirmTitle/i)).toBeInTheDocument()

      // Act
      rerender(
        <EventEmitterContextProvider>
          <RegenerationModal {...defaultProps} isShow={false} />
        </EventEmitterContextProvider>,
      )

      // Assert
      expect(screen.queryByText(/segment\.regenerationConfirmTitle/i)).not.toBeInTheDocument()
    })

    it('should maintain handlers when rerendered', () => {
      // Arrange
      const mockOnConfirm = vi.fn()
      const { rerender } = render(
        <RegenerationModal {...defaultProps} onConfirm={mockOnConfirm} />,
        { wrapper: createWrapper() },
      )

      // Act
      rerender(
        <EventEmitterContextProvider>
          <RegenerationModal {...defaultProps} onConfirm={mockOnConfirm} />
        </EventEmitterContextProvider>,
      )
      fireEvent.click(screen.getByText(/operation\.regenerate/i))

      // Assert
      expect(mockOnConfirm).toHaveBeenCalledTimes(1)
    })
  })
})
