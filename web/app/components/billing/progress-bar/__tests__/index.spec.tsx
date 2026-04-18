import { render, screen } from '@testing-library/react'
import ProgressBar from '../index'

describe('ProgressBar', () => {
  describe('Normal Mode (determinate)', () => {
    it('renders with provided percent as the Meter indicator width', () => {
      render(<ProgressBar percent={42} />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar.getAttribute('style')).toContain('width: 42%')
    })

    it('caps width at 100% when percent exceeds max', () => {
      render(<ProgressBar percent={150} />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar.getAttribute('style')).toContain('width: 100%')
    })

    it('renders with the neutral tone by default', () => {
      render(<ProgressBar percent={20} />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar.className).toContain('bg-components-progress-bar-progress-solid')
    })

    it('applies warning tone classes when tone="warning"', () => {
      render(<ProgressBar percent={85} tone="warning" />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar.className).toContain('bg-components-progress-warning-progress')
    })

    it('applies error tone classes when tone="error"', () => {
      render(<ProgressBar percent={100} tone="error" />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar.className).toContain('bg-components-progress-error-progress')
    })

    it('exposes role="meter" with ARIA metadata on the root', () => {
      render(<ProgressBar percent={42} />)

      const meter = screen.getByRole('meter')
      expect(meter).toHaveAttribute('aria-valuemin', '0')
      expect(meter).toHaveAttribute('aria-valuemax', '100')
      expect(meter).toHaveAttribute('aria-valuenow', '42')
    })
  })

  describe('Indeterminate Mode', () => {
    it('should render indeterminate progress bar when indeterminate is true', () => {
      render(<ProgressBar indeterminate />)

      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should not render the Meter indicator when indeterminate is true', () => {
      render(<ProgressBar indeterminate />)

      expect(screen.queryByTestId('billing-progress-bar')).not.toBeInTheDocument()
      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('is aria-hidden because it carries no semantic value', () => {
      const { container } = render(<ProgressBar indeterminate />)

      const wrapper = container.querySelector('[aria-hidden="true"]')
      expect(wrapper).not.toBeNull()
    })

    it('should render with different width based on indeterminateFull prop', () => {
      const { rerender } = render(<ProgressBar indeterminate indeterminateFull={false} />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      const partialClassName = bar.className

      rerender(<ProgressBar indeterminate indeterminateFull />)

      const fullClassName = screen.getByTestId('billing-progress-bar-indeterminate').className
      expect(partialClassName).not.toBe(fullClassName)
    })
  })
})
