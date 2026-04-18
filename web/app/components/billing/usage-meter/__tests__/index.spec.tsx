import { render, screen } from '@testing-library/react'
import UsageMeter from '../index'

describe('UsageMeter', () => {
  describe('Normal Mode (determinate)', () => {
    it('renders with provided percent as the Meter indicator width', () => {
      render(<UsageMeter percent={42} />)

      const bar = screen.getByTestId('billing-usage-meter')
      expect(bar.getAttribute('style')).toContain('width: 42%')
    })

    it('caps width at 100% when percent exceeds max', () => {
      render(<UsageMeter percent={150} />)

      const bar = screen.getByTestId('billing-usage-meter')
      expect(bar.getAttribute('style')).toContain('width: 100%')
    })

    it('renders with the neutral tone by default', () => {
      render(<UsageMeter percent={20} />)

      const bar = screen.getByTestId('billing-usage-meter')
      expect(bar.className).toContain('bg-components-progress-bar-progress-solid')
    })

    it('applies warning tone classes when tone="warning"', () => {
      render(<UsageMeter percent={85} tone="warning" />)

      const bar = screen.getByTestId('billing-usage-meter')
      expect(bar.className).toContain('bg-components-progress-warning-progress')
    })

    it('applies error tone classes when tone="error"', () => {
      render(<UsageMeter percent={100} tone="error" />)

      const bar = screen.getByTestId('billing-usage-meter')
      expect(bar.className).toContain('bg-components-progress-error-progress')
    })

    it('exposes role="meter" with ARIA metadata on the root', () => {
      render(<UsageMeter percent={42} />)

      const meter = screen.getByRole('meter')
      expect(meter).toHaveAttribute('aria-valuemin', '0')
      expect(meter).toHaveAttribute('aria-valuemax', '100')
      expect(meter).toHaveAttribute('aria-valuenow', '42')
    })
  })

  describe('Indeterminate Mode', () => {
    it('should render indeterminate bar when indeterminate is true', () => {
      render(<UsageMeter indeterminate />)

      expect(screen.getByTestId('billing-usage-meter-indeterminate')).toBeInTheDocument()
    })

    it('should not render the Meter indicator when indeterminate is true', () => {
      render(<UsageMeter indeterminate />)

      expect(screen.queryByTestId('billing-usage-meter')).not.toBeInTheDocument()
      expect(screen.getByTestId('billing-usage-meter-indeterminate')).toBeInTheDocument()
    })

    it('is aria-hidden because it carries no semantic value', () => {
      const { container } = render(<UsageMeter indeterminate />)

      const wrapper = container.querySelector('[aria-hidden="true"]')
      expect(wrapper).not.toBeNull()
    })

    it('should render with different width based on indeterminateFull prop', () => {
      const { rerender } = render(<UsageMeter indeterminate indeterminateFull={false} />)

      const bar = screen.getByTestId('billing-usage-meter-indeterminate')
      const partialClassName = bar.className

      rerender(<UsageMeter indeterminate indeterminateFull />)

      const fullClassName = screen.getByTestId('billing-usage-meter-indeterminate').className
      expect(partialClassName).not.toBe(fullClassName)
    })
  })
})
