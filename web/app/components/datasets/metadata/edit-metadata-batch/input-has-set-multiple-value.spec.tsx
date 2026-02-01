import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InputHasSetMultipleValue from './input-has-set-multiple-value'

describe('InputHasSetMultipleValue', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with correct wrapper styling', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)
      expect(container.firstChild).toHaveClass('h-6', 'grow', 'rounded-md', 'bg-components-input-bg-normal', 'p-0.5')
    })

    it('should render multiple value text', () => {
      const handleClear = vi.fn()
      render(<InputHasSetMultipleValue onClear={handleClear} />)
      // The text should come from i18n
      expect(screen.getByText(/multipleValue|Multiple/i)).toBeInTheDocument()
    })

    it('should render close icon when not readOnly', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)
      // Should have close icon (RiCloseLine)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should not show close icon when readOnly is true', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} readOnly />)
      // Should not have close icon
      const svg = container.querySelector('svg')
      expect(svg).not.toBeInTheDocument()
    })

    it('should show close icon when readOnly is false', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} readOnly={false} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should show close icon when readOnly is undefined', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} readOnly={undefined} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should apply pr-1.5 padding when readOnly', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} readOnly />)
      const badge = container.querySelector('.inline-flex')
      expect(badge).toHaveClass('pr-1.5')
    })

    it('should apply pr-0.5 padding when not readOnly', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)
      const badge = container.querySelector('.inline-flex')
      expect(badge).toHaveClass('pr-0.5')
    })
  })

  describe('User Interactions', () => {
    it('should call onClear when close icon is clicked', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)

      const closeIcon = container.querySelector('svg')
      expect(closeIcon).toBeInTheDocument()

      if (closeIcon) {
        fireEvent.click(closeIcon)
      }

      expect(handleClear).toHaveBeenCalledTimes(1)
    })

    it('should not call onClear when readOnly and clicking on component', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} readOnly />)

      // Click on the wrapper
      fireEvent.click(container.firstChild as HTMLElement)

      expect(handleClear).not.toHaveBeenCalled()
    })

    it('should call onClear multiple times on multiple clicks', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)

      const closeIcon = container.querySelector('svg')

      if (closeIcon) {
        fireEvent.click(closeIcon)
        fireEvent.click(closeIcon)
        fireEvent.click(closeIcon)
      }

      expect(handleClear).toHaveBeenCalledTimes(3)
    })
  })

  describe('Styling', () => {
    it('should have badge styling', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)
      const badge = container.querySelector('.inline-flex')
      expect(badge).toHaveClass('h-5', 'items-center', 'rounded-[5px]', 'border-[0.5px]')
    })

    it('should have hover styles on close button wrapper', () => {
      const handleClear = vi.fn()
      const { container } = render(<InputHasSetMultipleValue onClear={handleClear} />)
      const closeWrapper = container.querySelector('.cursor-pointer')
      expect(closeWrapper).toHaveClass('hover:bg-state-base-hover', 'hover:text-text-secondary')
    })
  })

  describe('Edge Cases', () => {
    it('should render correctly when switching readOnly state', () => {
      const handleClear = vi.fn()
      const { container, rerender } = render(<InputHasSetMultipleValue onClear={handleClear} />)

      // Initially not readOnly
      expect(container.querySelector('svg')).toBeInTheDocument()

      // Switch to readOnly
      rerender(<InputHasSetMultipleValue onClear={handleClear} readOnly />)
      expect(container.querySelector('svg')).not.toBeInTheDocument()

      // Switch back to not readOnly
      rerender(<InputHasSetMultipleValue onClear={handleClear} readOnly={false} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })
})
