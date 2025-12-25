import { render, screen } from '@testing-library/react'
import ProgressBar from './index'

describe('ProgressBar', () => {
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

    expect(screen.getByTestId('billing-progress-bar')).toHaveClass('#2970FF')
  })
})
