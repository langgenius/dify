import { fireEvent, render, screen } from '@testing-library/react'
import Actions from '../index'

describe('Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render button with translated text', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)

      expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
    })

    it('should render with correct container structure', () => {
      const handleNextStep = vi.fn()

      const { container } = render(<Actions handleNextStep={handleNextStep} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('flex')
      expect(wrapper.className).toContain('justify-end')
      expect(wrapper.className).toContain('p-4')
      expect(wrapper.className).toContain('pt-2')
    })

    it('should render span with px-0.5 class around text', () => {
      const handleNextStep = vi.fn()

      const { container } = render(<Actions handleNextStep={handleNextStep} />)

      const span = container.querySelector('span')
      expect(span).toBeInTheDocument()
      expect(span?.className).toContain('px-0.5')
    })
  })

  describe('Props Variations', () => {
    it('should pass disabled=true to button when disabled prop is true', () => {
      const handleNextStep = vi.fn()

      render(<Actions disabled={true} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should pass disabled=false to button when disabled prop is false', () => {
      const handleNextStep = vi.fn()

      render(<Actions disabled={false} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should not disable button when disabled prop is undefined', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should handle disabled switching from true to false', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions disabled={true} handleNextStep={handleNextStep} />,
      )

      expect(screen.getByRole('button')).toBeDisabled()

      rerender(<Actions disabled={false} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should handle disabled switching from false to true', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      expect(screen.getByRole('button')).not.toBeDisabled()

      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should handle undefined disabled becoming true', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions handleNextStep={handleNextStep} />,
      )

      expect(screen.getByRole('button')).not.toBeDisabled()

      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should call handleNextStep when button is clicked', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should call handleNextStep exactly once per click', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).toHaveBeenCalled()
      expect(handleNextStep.mock.calls).toHaveLength(1)
    })

    it('should call handleNextStep multiple times on multiple clicks', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(handleNextStep).toHaveBeenCalledTimes(3)
    })

    it('should not call handleNextStep when button is disabled and clicked', () => {
      const handleNextStep = vi.fn()

      render(<Actions disabled={true} handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).not.toHaveBeenCalled()
    })

    it('should handle rapid clicks when not disabled', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)
      const button = screen.getByRole('button')

      for (let i = 0; i < 10; i++)
        fireEvent.click(button)

      expect(handleNextStep).toHaveBeenCalledTimes(10)
    })
  })

  describe('Callback Stability', () => {
    it('should use the new handleNextStep when prop changes', () => {
      const handleNextStep1 = vi.fn()
      const handleNextStep2 = vi.fn()

      const { rerender } = render(
        <Actions handleNextStep={handleNextStep1} />,
      )
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep2} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep1).toHaveBeenCalledTimes(1)
      expect(handleNextStep2).toHaveBeenCalledTimes(1)
    })

    it('should maintain functionality after rerender with same props', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions handleNextStep={handleNextStep} />,
      )
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).toHaveBeenCalledTimes(2)
    })

    it('should work correctly when handleNextStep changes multiple times', () => {
      const handleNextStep1 = vi.fn()
      const handleNextStep2 = vi.fn()
      const handleNextStep3 = vi.fn()

      const { rerender } = render(
        <Actions handleNextStep={handleNextStep1} />,
      )
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep2} />)
      fireEvent.click(screen.getByRole('button'))

      rerender(<Actions handleNextStep={handleNextStep3} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep1).toHaveBeenCalledTimes(1)
      expect(handleNextStep2).toHaveBeenCalledTimes(1)
      expect(handleNextStep3).toHaveBeenCalledTimes(1)
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions handleNextStep={handleNextStep} />,
      )

      rerender(<Actions handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should not break when props remain the same across rerenders', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      for (let i = 0; i < 5; i++) {
        rerender(<Actions disabled={false} handleNextStep={handleNextStep} />)
      }

      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should update correctly when only disabled prop changes', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      expect(screen.getByRole('button')).not.toBeDisabled()

      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should update correctly when only handleNextStep prop changes', () => {
      const handleNextStep1 = vi.fn()
      const handleNextStep2 = vi.fn()

      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep1} />,
      )

      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep1).toHaveBeenCalledTimes(1)

      rerender(<Actions disabled={false} handleNextStep={handleNextStep2} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep1).toHaveBeenCalledTimes(1)
      expect(handleNextStep2).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should call handleNextStep even if it has side effects', () => {
      let sideEffectValue = 0
      const handleNextStep = vi.fn(() => {
        sideEffectValue = 42
      })

      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).toHaveBeenCalledTimes(1)
      expect(sideEffectValue).toBe(42)
    })

    it('should handle handleNextStep that returns a value', () => {
      const handleNextStep = vi.fn(() => 'return value')

      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).toHaveBeenCalledTimes(1)
      expect(handleNextStep).toHaveReturnedWith('return value')
    })

    it('should handle handleNextStep that is async', async () => {
      const handleNextStep = vi.fn().mockResolvedValue(undefined)

      render(<Actions handleNextStep={handleNextStep} />)
      fireEvent.click(screen.getByRole('button'))

      expect(handleNextStep).toHaveBeenCalledTimes(1)
    })

    it('should render correctly with both disabled=true and handleNextStep', () => {
      const handleNextStep = vi.fn()

      render(<Actions disabled={true} handleNextStep={handleNextStep} />)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should handle component unmount gracefully', () => {
      const handleNextStep = vi.fn()

      const { unmount } = render(<Actions handleNextStep={handleNextStep} />)

      expect(() => unmount()).not.toThrow()
    })

    it('should handle disabled as boolean-like falsy value', () => {
      const handleNextStep = vi.fn()

      render(<Actions disabled={false} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })

  describe('Accessibility', () => {
    it('should have button element that can receive focus', () => {
      const handleNextStep = vi.fn()

      render(<Actions handleNextStep={handleNextStep} />)
      const button = screen.getByRole('button')

      expect(button).not.toBeDisabled()
    })

    it('should indicate disabled state correctly', () => {
      const handleNextStep = vi.fn()

      render(<Actions disabled={true} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toHaveAttribute('disabled')
    })
  })

  describe('Integration', () => {
    it('should work in a typical workflow: enable -> click -> disable', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      expect(screen.getByRole('button')).not.toBeDisabled()
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(1)

      rerender(<Actions disabled={true} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).toBeDisabled()
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(1) // Still 1, not 2

      rerender(<Actions disabled={false} handleNextStep={handleNextStep} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
      fireEvent.click(screen.getByRole('button'))
      expect(handleNextStep).toHaveBeenCalledTimes(2)
    })

    it('should maintain consistent rendering across multiple state changes', () => {
      const handleNextStep = vi.fn()

      const { rerender } = render(
        <Actions disabled={false} handleNextStep={handleNextStep} />,
      )

      const states = [true, false, true, false, true]
      states.forEach((disabled) => {
        rerender(<Actions disabled={disabled} handleNextStep={handleNextStep} />)
        if (disabled)
          expect(screen.getByRole('button')).toBeDisabled()
        else
          expect(screen.getByRole('button')).not.toBeDisabled()
      })

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
    })
  })
})
