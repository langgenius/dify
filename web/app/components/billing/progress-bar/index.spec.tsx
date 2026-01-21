import { render, screen } from '@testing-library/react'
import ProgressBar from './index'

describe('ProgressBar', () => {
  describe('Normal Mode (determinate)', () => {
    it('renders with provided percent and color', () => {
      render(<ProgressBar percent={42} color="bg-test-color" />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar).toHaveClass('bg-test-color')
      expect(bar.getAttribute('style')).toContain('width: 42%')
    })

    it('caps width at 100% when percent exceeds max', () => {
      render(<ProgressBar percent={150} color="bg-test-color" />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar.getAttribute('style')).toContain('width: 100%')
    })

    it('uses the default color when no color prop is provided', () => {
      render(<ProgressBar percent={20} color={undefined as unknown as string} />)

      const bar = screen.getByTestId('billing-progress-bar')
      expect(bar).toHaveClass('bg-components-progress-bar-progress-solid')
      expect(bar.getAttribute('style')).toContain('width: 20%')
    })
  })

  describe('Indeterminate Mode', () => {
    it('should render indeterminate progress bar when indeterminate is true', () => {
      render(<ProgressBar percent={0} color="bg-test-color" indeterminate />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toBeInTheDocument()
      expect(bar).toHaveClass('bg-progress-bar-indeterminate-stripe')
    })

    it('should not render normal progress bar when indeterminate is true', () => {
      render(<ProgressBar percent={50} color="bg-test-color" indeterminate />)

      expect(screen.queryByTestId('billing-progress-bar')).not.toBeInTheDocument()
      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should render with default width (w-[30px]) when indeterminateFull is false', () => {
      render(<ProgressBar percent={0} color="bg-test-color" indeterminate indeterminateFull={false} />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toHaveClass('w-[30px]')
      expect(bar).not.toHaveClass('w-full')
    })

    it('should render with full width (w-full) when indeterminateFull is true', () => {
      render(<ProgressBar percent={0} color="bg-test-color" indeterminate indeterminateFull />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toHaveClass('w-full')
      expect(bar).not.toHaveClass('w-[30px]')
    })
  })
})
