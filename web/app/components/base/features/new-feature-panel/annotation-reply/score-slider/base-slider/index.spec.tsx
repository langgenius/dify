import { render, screen } from '@testing-library/react'
import Slider from './index'

describe('BaseSlider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the slider component', () => {
    render(<Slider value={50} onChange={vi.fn()} />)

    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('should display the formatted value in the thumb', () => {
    render(<Slider value={85} onChange={vi.fn()} />)

    expect(screen.getByText('0.85')).toBeInTheDocument()
  })

  it('should use default min/max/step when not provided', () => {
    render(<Slider value={50} onChange={vi.fn()} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
  })

  it('should use custom min/max/step when provided', () => {
    render(<Slider value={90} min={80} max={100} step={5} onChange={vi.fn()} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '80')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '90')
  })

  it('should handle NaN value as 0', () => {
    render(<Slider value={Number.NaN} onChange={vi.fn()} />)

    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0')
  })

  it('should pass disabled prop', () => {
    render(<Slider value={50} disabled onChange={vi.fn()} />)

    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
  })
})
