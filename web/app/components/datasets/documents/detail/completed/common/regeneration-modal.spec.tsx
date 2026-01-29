import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitterContextProvider, useEventEmitterContextContext } from '@/context/event-emitter'
import RegenerationModal from './regeneration-modal'

// Store emit function for triggering events in tests
let emitFunction: ((v: string) => void) | null = null

const EmitCapture = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  emitFunction = eventEmitter?.emit?.bind(eventEmitter) || null
  return null
}

// Custom wrapper that captures emit function
const TestWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <EventEmitterContextProvider>
      <EmitCapture />
      {children}
    </EventEmitterContextProvider>
  )
}

// Create a wrapper component with event emitter context
const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => (
    <TestWrapper>
      {children}
    </TestWrapper>
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
        <TestWrapper>
          <RegenerationModal {...defaultProps} isShow={false} />
        </TestWrapper>,
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
        <TestWrapper>
          <RegenerationModal {...defaultProps} onConfirm={mockOnConfirm} />
        </TestWrapper>,
      )
      fireEvent.click(screen.getByText(/operation\.regenerate/i))

      // Assert
      expect(mockOnConfirm).toHaveBeenCalledTimes(1)
    })
  })

  // Loading state
  describe('Loading State', () => {
    it('should show regenerating content when update-segment event is emitted', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act
      act(() => {
        if (emitFunction)
          emitFunction('update-segment')
      })

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/segment\.regeneratingTitle/i)).toBeInTheDocument()
      })
    })

    it('should show regenerating message during loading', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act
      act(() => {
        if (emitFunction)
          emitFunction('update-segment')
      })

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/segment\.regeneratingMessage/i)).toBeInTheDocument()
      })
    })

    it('should disable regenerate button during loading', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act
      act(() => {
        if (emitFunction)
          emitFunction('update-segment')
      })

      // Assert
      await waitFor(() => {
        const button = screen.getByText(/operation\.regenerate/i).closest('button')
        expect(button).toBeDisabled()
      })
    })
  })

  // Success state
  describe('Success State', () => {
    it('should show success content when update-segment-success event is emitted followed by done', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act - trigger loading then success then done
      act(() => {
        if (emitFunction) {
          emitFunction('update-segment')
          emitFunction('update-segment-success')
          emitFunction('update-segment-done')
        }
      })

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/segment\.regenerationSuccessTitle/i)).toBeInTheDocument()
      })
    })

    it('should show success message when completed', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act
      act(() => {
        if (emitFunction) {
          emitFunction('update-segment')
          emitFunction('update-segment-success')
          emitFunction('update-segment-done')
        }
      })

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/segment\.regenerationSuccessMessage/i)).toBeInTheDocument()
      })
    })

    it('should show close button with countdown in success state', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act
      act(() => {
        if (emitFunction) {
          emitFunction('update-segment')
          emitFunction('update-segment-success')
          emitFunction('update-segment-done')
        }
      })

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/operation\.close/i)).toBeInTheDocument()
      })
    })

    it('should call onClose when close button is clicked in success state', async () => {
      // Arrange
      const mockOnClose = vi.fn()
      render(<RegenerationModal {...defaultProps} onClose={mockOnClose} />, { wrapper: createWrapper() })

      // Act
      act(() => {
        if (emitFunction) {
          emitFunction('update-segment')
          emitFunction('update-segment-success')
          emitFunction('update-segment-done')
        }
      })

      await waitFor(() => {
        expect(screen.getByText(/operation\.close/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/operation\.close/i))

      // Assert
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  // State transitions
  describe('State Transitions', () => {
    it('should return to default content when update fails (no success event)', async () => {
      // Arrange
      render(<RegenerationModal {...defaultProps} />, { wrapper: createWrapper() })

      // Act - trigger loading then done without success
      act(() => {
        if (emitFunction) {
          emitFunction('update-segment')
          emitFunction('update-segment-done')
        }
      })

      // Assert - should show default content
      await waitFor(() => {
        expect(screen.getByText(/segment\.regenerationConfirmTitle/i)).toBeInTheDocument()
      })
    })
  })
})
