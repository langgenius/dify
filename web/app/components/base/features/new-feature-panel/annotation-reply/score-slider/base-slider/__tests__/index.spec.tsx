import { render, screen } from '@testing-library/react'
import { ScoreSliderBase } from '../index'

describe('BaseSlider', () => {
  const getSliderInput = () => screen.getByLabelText('Annotation score threshold')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the slider component', () => {
    render(<ScoreSliderBase value={50} onChange={vi.fn()} />)

    expect(getSliderInput()).toBeInTheDocument()
  })

  it('should display the formatted value in the thumb', () => {
    render(<ScoreSliderBase value={85} onChange={vi.fn()} />)

    expect(screen.getByText('0.85')).toBeInTheDocument()
  })

  it('should use default min/max/step when not provided', () => {
    render(<ScoreSliderBase value={80} onChange={vi.fn()} />)

    const slider = getSliderInput()
    expect(slider).toHaveAttribute('min', '80')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '80')
  })

  it('should use custom min/max/step when provided', () => {
    render(<ScoreSliderBase value={90} min={80} max={100} step={5} onChange={vi.fn()} />)

    const slider = getSliderInput()
    expect(slider).toHaveAttribute('min', '80')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '90')
  })

  it('should handle NaN value as min', () => {
    render(<ScoreSliderBase value={Number.NaN} onChange={vi.fn()} />)

    expect(getSliderInput()).toHaveAttribute('aria-valuenow', '80')
  })

  it('should pass disabled prop', () => {
    render(<ScoreSliderBase value={80} disabled onChange={vi.fn()} />)

    expect(getSliderInput()).toBeDisabled()
  })
})
