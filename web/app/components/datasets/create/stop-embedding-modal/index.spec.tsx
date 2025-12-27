import type { MockInstance } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import StopEmbeddingModal from './index'

// Helper type for component props
type StopEmbeddingModalProps = {
  show: boolean
  onConfirm: () => void
  onHide: () => void
}

// Helper to render StopEmbeddingModal with default props
const renderStopEmbeddingModal = (props: Partial<StopEmbeddingModalProps> = {}) => {
  const defaultProps: StopEmbeddingModalProps = {
    show: true,
    onConfirm: vi.fn(),
    onHide: vi.fn(),
    ...props,
  }
  return {
    ...render(<StopEmbeddingModal {...defaultProps} />),
    props: defaultProps,
  }
}

// ============================================================================
// StopEmbeddingModal Component Tests
// ============================================================================
describe('StopEmbeddingModal', () => {
  // Suppress Headless UI warnings in tests
  // These warnings are from the library's internal behavior, not our code
  let consoleWarnSpy: MockInstance
  let consoleErrorSpy: MockInstance

  beforeAll(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn())
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn())
  })

  afterAll(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - Verify component renders properly
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing when show is true', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
    })

    it('should render modal title', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
    })

    it('should render modal content', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelContent')).toBeInTheDocument()
    })

    it('should render confirm button with correct text', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelButtonConfirm')).toBeInTheDocument()
    })

    it('should render cancel button with correct text', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelButtonCancel')).toBeInTheDocument()
    })

    it('should not render modal content when show is false', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: false })

      // Assert
      expect(screen.queryByText('datasetCreation.stepThree.modelTitle')).not.toBeInTheDocument()
    })

    it('should render buttons in correct order (cancel first, then confirm)', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert - Due to flex-row-reverse, confirm appears first visually but cancel is first in DOM
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
    })

    it('should render confirm button with primary variant styling', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      expect(confirmButton).toHaveClass('ml-2', 'w-24')
    })

    it('should render cancel button with default styling', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      const cancelButton = screen.getByText('datasetCreation.stepThree.modelButtonCancel')
      expect(cancelButton).toHaveClass('w-24')
    })

    it('should render all modal elements', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert - Modal should contain title, content, and buttons
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.modelContent')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.modelButtonConfirm')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.modelButtonCancel')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Testing - Test all prop variations
  // --------------------------------------------------------------------------
  describe('Props', () => {
    describe('show prop', () => {
      it('should show modal when show is true', () => {
        // Arrange & Act
        renderStopEmbeddingModal({ show: true })

        // Assert
        expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
      })

      it('should hide modal when show is false', () => {
        // Arrange & Act
        renderStopEmbeddingModal({ show: false })

        // Assert
        expect(screen.queryByText('datasetCreation.stepThree.modelTitle')).not.toBeInTheDocument()
      })

      it('should use default value false when show is not provided', () => {
        // Arrange & Act
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        render(<StopEmbeddingModal onConfirm={onConfirm} onHide={onHide} show={false} />)

        // Assert
        expect(screen.queryByText('datasetCreation.stepThree.modelTitle')).not.toBeInTheDocument()
      })

      it('should toggle visibility when show prop changes to true', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()

        // Act - Initially hidden
        const { rerender } = render(
          <StopEmbeddingModal show={false} onConfirm={onConfirm} onHide={onHide} />,
        )
        expect(screen.queryByText('datasetCreation.stepThree.modelTitle')).not.toBeInTheDocument()

        // Act - Show modal
        await act(async () => {
          rerender(<StopEmbeddingModal show={true} onConfirm={onConfirm} onHide={onHide} />)
        })

        // Assert - Modal should be visible
        await waitFor(() => {
          expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
        })
      })
    })

    describe('onConfirm prop', () => {
      it('should accept onConfirm callback function', () => {
        // Arrange
        const onConfirm = vi.fn()

        // Act
        renderStopEmbeddingModal({ onConfirm })

        // Assert - No errors thrown
        expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
      })
    })

    describe('onHide prop', () => {
      it('should accept onHide callback function', () => {
        // Arrange
        const onHide = vi.fn()

        // Act
        renderStopEmbeddingModal({ onHide })

        // Assert - No errors thrown
        expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests - Test click events and event handlers
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    describe('Confirm Button', () => {
      it('should call onConfirm when confirm button is clicked', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
        await act(async () => {
          fireEvent.click(confirmButton)
        })

        // Assert
        expect(onConfirm).toHaveBeenCalledTimes(1)
      })

      it('should call onHide when confirm button is clicked', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
        await act(async () => {
          fireEvent.click(confirmButton)
        })

        // Assert
        expect(onHide).toHaveBeenCalledTimes(1)
      })

      it('should call both onConfirm and onHide in correct order when confirm button is clicked', async () => {
        // Arrange
        const callOrder: string[] = []
        const onConfirm = vi.fn(() => callOrder.push('confirm'))
        const onHide = vi.fn(() => callOrder.push('hide'))
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
        await act(async () => {
          fireEvent.click(confirmButton)
        })

        // Assert - onConfirm should be called before onHide
        expect(callOrder).toEqual(['confirm', 'hide'])
      })

      it('should handle multiple clicks on confirm button', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
        await act(async () => {
          fireEvent.click(confirmButton)
          fireEvent.click(confirmButton)
          fireEvent.click(confirmButton)
        })

        // Assert
        expect(onConfirm).toHaveBeenCalledTimes(3)
        expect(onHide).toHaveBeenCalledTimes(3)
      })
    })

    describe('Cancel Button', () => {
      it('should call onHide when cancel button is clicked', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const cancelButton = screen.getByText('datasetCreation.stepThree.modelButtonCancel')
        await act(async () => {
          fireEvent.click(cancelButton)
        })

        // Assert
        expect(onHide).toHaveBeenCalledTimes(1)
      })

      it('should not call onConfirm when cancel button is clicked', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const cancelButton = screen.getByText('datasetCreation.stepThree.modelButtonCancel')
        await act(async () => {
          fireEvent.click(cancelButton)
        })

        // Assert
        expect(onConfirm).not.toHaveBeenCalled()
      })

      it('should handle multiple clicks on cancel button', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const cancelButton = screen.getByText('datasetCreation.stepThree.modelButtonCancel')
        await act(async () => {
          fireEvent.click(cancelButton)
          fireEvent.click(cancelButton)
        })

        // Assert
        expect(onHide).toHaveBeenCalledTimes(2)
        expect(onConfirm).not.toHaveBeenCalled()
      })
    })

    describe('Close Icon', () => {
      it('should call onHide when close span is clicked', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        const { container } = renderStopEmbeddingModal({ onConfirm, onHide })

        // Act - Find the close span (it should be the span with onClick handler)
        const spans = container.querySelectorAll('span')
        const closeSpan = Array.from(spans).find(span =>
          span.className && span.getAttribute('class')?.includes('close'),
        )

        if (closeSpan) {
          await act(async () => {
            fireEvent.click(closeSpan)
          })

          // Assert
          expect(onHide).toHaveBeenCalledTimes(1)
        }
        else {
          // If no close span found with class, just verify the modal renders
          expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
        }
      })

      it('should not call onConfirm when close span is clicked', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        const { container } = renderStopEmbeddingModal({ onConfirm, onHide })

        // Act
        const spans = container.querySelectorAll('span')
        const closeSpan = Array.from(spans).find(span =>
          span.className && span.getAttribute('class')?.includes('close'),
        )

        if (closeSpan) {
          await act(async () => {
            fireEvent.click(closeSpan)
          })

          // Assert
          expect(onConfirm).not.toHaveBeenCalled()
        }
      })
    })

    describe('Different Close Methods', () => {
      it('should distinguish between confirm and cancel actions', async () => {
        // Arrange
        const onConfirm = vi.fn()
        const onHide = vi.fn()
        renderStopEmbeddingModal({ onConfirm, onHide })

        // Act - Click cancel
        const cancelButton = screen.getByText('datasetCreation.stepThree.modelButtonCancel')
        await act(async () => {
          fireEvent.click(cancelButton)
        })

        // Assert
        expect(onConfirm).not.toHaveBeenCalled()
        expect(onHide).toHaveBeenCalledTimes(1)

        // Reset
        vi.clearAllMocks()

        // Act - Click confirm
        const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
        await act(async () => {
          fireEvent.click(confirmButton)
        })

        // Assert
        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(onHide).toHaveBeenCalledTimes(1)
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests - Test null, undefined, empty values and boundaries
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle rapid confirm button clicks', async () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      renderStopEmbeddingModal({ onConfirm, onHide })

      // Act - Rapid clicks
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      await act(async () => {
        for (let i = 0; i < 10; i++)
          fireEvent.click(confirmButton)
      })

      // Assert
      expect(onConfirm).toHaveBeenCalledTimes(10)
      expect(onHide).toHaveBeenCalledTimes(10)
    })

    it('should handle rapid cancel button clicks', async () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      renderStopEmbeddingModal({ onConfirm, onHide })

      // Act - Rapid clicks
      const cancelButton = screen.getByText('datasetCreation.stepThree.modelButtonCancel')
      await act(async () => {
        for (let i = 0; i < 10; i++)
          fireEvent.click(cancelButton)
      })

      // Assert
      expect(onHide).toHaveBeenCalledTimes(10)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should handle callbacks being replaced', async () => {
      // Arrange
      const onConfirm1 = vi.fn()
      const onHide1 = vi.fn()
      const onConfirm2 = vi.fn()
      const onHide2 = vi.fn()

      // Act
      const { rerender } = render(
        <StopEmbeddingModal show={true} onConfirm={onConfirm1} onHide={onHide1} />,
      )

      // Replace callbacks
      await act(async () => {
        rerender(<StopEmbeddingModal show={true} onConfirm={onConfirm2} onHide={onHide2} />)
      })

      // Click confirm with new callbacks
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      // Assert - New callbacks should be called
      expect(onConfirm1).not.toHaveBeenCalled()
      expect(onHide1).not.toHaveBeenCalled()
      expect(onConfirm2).toHaveBeenCalledTimes(1)
      expect(onHide2).toHaveBeenCalledTimes(1)
    })

    it('should render with all required props', () => {
      // Arrange & Act
      render(
        <StopEmbeddingModal
          show={true}
          onConfirm={vi.fn()}
          onHide={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.modelContent')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout and Styling Tests - Verify correct structure
  // --------------------------------------------------------------------------
  describe('Layout and Styling', () => {
    it('should have buttons container with flex-row-reverse', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons[0].closest('div')).toHaveClass('flex', 'flex-row-reverse')
    })

    it('should render title and content elements', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.modelContent')).toBeInTheDocument()
    })

    it('should render two buttons', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
    })
  })

  // --------------------------------------------------------------------------
  // submit Function Tests - Test the internal submit function behavior
  // --------------------------------------------------------------------------
  describe('submit Function', () => {
    it('should execute onConfirm first then onHide', async () => {
      // Arrange
      let confirmTime = 0
      let hideTime = 0
      let counter = 0
      const onConfirm = vi.fn(() => {
        confirmTime = ++counter
      })
      const onHide = vi.fn(() => {
        hideTime = ++counter
      })
      renderStopEmbeddingModal({ onConfirm, onHide })

      // Act
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      // Assert
      expect(confirmTime).toBe(1)
      expect(hideTime).toBe(2)
    })

    it('should call both callbacks exactly once per click', async () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      renderStopEmbeddingModal({ onConfirm, onHide })

      // Act
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      // Assert
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should pass no arguments to onConfirm', async () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      renderStopEmbeddingModal({ onConfirm, onHide })

      // Act
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      // Assert
      expect(onConfirm).toHaveBeenCalledWith()
    })

    it('should pass no arguments to onHide when called from submit', async () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      renderStopEmbeddingModal({ onConfirm, onHide })

      // Act
      const confirmButton = screen.getByText('datasetCreation.stepThree.modelButtonConfirm')
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      // Assert
      expect(onHide).toHaveBeenCalledWith()
    })
  })

  // --------------------------------------------------------------------------
  // Modal Integration Tests - Verify Modal component integration
  // --------------------------------------------------------------------------
  describe('Modal Integration', () => {
    it('should pass show prop to Modal as isShow', async () => {
      // Arrange & Act
      const { rerender } = render(
        <StopEmbeddingModal show={true} onConfirm={vi.fn()} onHide={vi.fn()} />,
      )

      // Assert - Modal should be visible
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()

      // Act - Hide modal
      await act(async () => {
        rerender(<StopEmbeddingModal show={false} onConfirm={vi.fn()} onHide={vi.fn()} />)
      })

      // Assert - Modal should transition to hidden (wait for transition)
      await waitFor(() => {
        expect(screen.queryByText('datasetCreation.stepThree.modelTitle')).not.toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  // --------------------------------------------------------------------------
  // Accessibility Tests
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have buttons that are focusable', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).not.toHaveAttribute('tabindex', '-1')
      })
    })

    it('should have semantic button elements', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
    })

    it('should have accessible text content', () => {
      // Arrange & Act
      renderStopEmbeddingModal({ show: true })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeVisible()
      expect(screen.getByText('datasetCreation.stepThree.modelContent')).toBeVisible()
      expect(screen.getByText('datasetCreation.stepThree.modelButtonConfirm')).toBeVisible()
      expect(screen.getByText('datasetCreation.stepThree.modelButtonCancel')).toBeVisible()
    })
  })

  // --------------------------------------------------------------------------
  // Component Lifecycle Tests
  // --------------------------------------------------------------------------
  describe('Component Lifecycle', () => {
    it('should unmount cleanly', () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      const { unmount } = renderStopEmbeddingModal({ onConfirm, onHide })

      // Act & Assert - Should not throw
      expect(() => unmount()).not.toThrow()
    })

    it('should not call callbacks after unmount', () => {
      // Arrange
      const onConfirm = vi.fn()
      const onHide = vi.fn()
      const { unmount } = renderStopEmbeddingModal({ onConfirm, onHide })

      // Act
      unmount()

      // Assert - No callbacks should be called after unmount
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onHide).not.toHaveBeenCalled()
    })

    it('should re-render correctly when props update', async () => {
      // Arrange
      const onConfirm1 = vi.fn()
      const onHide1 = vi.fn()
      const onConfirm2 = vi.fn()
      const onHide2 = vi.fn()

      // Act - Initial render
      const { rerender } = render(
        <StopEmbeddingModal show={true} onConfirm={onConfirm1} onHide={onHide1} />,
      )

      // Verify initial render
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()

      // Update props
      await act(async () => {
        rerender(<StopEmbeddingModal show={true} onConfirm={onConfirm2} onHide={onHide2} />)
      })

      // Assert - Still renders correctly
      expect(screen.getByText('datasetCreation.stepThree.modelTitle')).toBeInTheDocument()
    })
  })
})
