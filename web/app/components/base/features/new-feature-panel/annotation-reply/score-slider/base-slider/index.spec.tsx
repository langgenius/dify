import { render, screen } from '@testing-library/react'
import Slider from './index'

vi.mock('react-slider', () => ({
  default: ({ value, min, max, step, disabled, onChange, renderThumb, className }: {
    value: number
    min: number
    max: number
    step: number
    disabled?: boolean
    onChange: (v: number) => void
    renderThumb: (props: Record<string, unknown>, state: { valueNow: number }) => React.ReactNode
    className: string
  }) => (
    <div data-testid="react-slider" className={className} data-disabled={disabled}>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
      />
      {renderThumb({ key: 'thumb' }, { valueNow: value })}
    </div>
  ),
}))

describe('BaseSlider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the slider component', () => {
    render(<Slider value={50} onChange={vi.fn()} />)

    expect(screen.getByTestId('react-slider')).toBeInTheDocument()
  })

  it('should display the formatted value in the thumb', () => {
    render(<Slider value={85} onChange={vi.fn()} />)

    expect(screen.getByText('0.85')).toBeInTheDocument()
  })

  it('should use default min/max/step when not provided', () => {
    render(<Slider value={50} onChange={vi.fn()} />)

    const input = screen.getByRole('slider')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '100')
    expect(input).toHaveAttribute('step', '1')
  })

  it('should use custom min/max/step when provided', () => {
    render(<Slider value={90} min={80} max={100} step={5} onChange={vi.fn()} />)

    const input = screen.getByRole('slider')
    expect(input).toHaveAttribute('min', '80')
    expect(input).toHaveAttribute('max', '100')
    expect(input).toHaveAttribute('step', '5')
  })

  it('should handle NaN value as 0', () => {
    render(<Slider value={Number.NaN} onChange={vi.fn()} />)

    expect(screen.getByRole('slider')).toHaveValue('0')
  })

  it('should pass disabled prop', () => {
    render(<Slider value={50} disabled onChange={vi.fn()} />)

    expect(screen.getByTestId('react-slider')).toHaveAttribute('data-disabled', 'true')
  })
})
