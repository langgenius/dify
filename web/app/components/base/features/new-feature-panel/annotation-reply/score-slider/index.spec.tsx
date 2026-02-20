import { render, screen } from '@testing-library/react'
import ScoreSlider from './index'

vi.mock('@/app/components/base/features/new-feature-panel/annotation-reply/score-slider/base-slider', () => ({
  default: ({ value, onChange, min, max }: { value: number, onChange: (v: number) => void, min: number, max: number }) => (
    <input
      type="range"
      data-testid="slider"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
    />
  ),
}))

describe('ScoreSlider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the slider', () => {
    render(<ScoreSlider value={90} onChange={vi.fn()} />)

    expect(screen.getByTestId('slider')).toBeInTheDocument()
  })

  it('should display easy match and accurate match labels', () => {
    render(<ScoreSlider value={90} onChange={vi.fn()} />)

    expect(screen.getByText('0.8')).toBeInTheDocument()
    expect(screen.getByText('1.0')).toBeInTheDocument()
    expect(screen.getByText(/feature\.annotation\.scoreThreshold\.easyMatch/)).toBeInTheDocument()
    expect(screen.getByText(/feature\.annotation\.scoreThreshold\.accurateMatch/)).toBeInTheDocument()
  })

  it('should render with custom className', () => {
    const { container } = render(<ScoreSlider className="custom-class" value={90} onChange={vi.fn()} />)

    // Verifying the component renders successfully with a custom className
    expect(screen.getByTestId('slider')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should pass value to the slider', () => {
    render(<ScoreSlider value={95} onChange={vi.fn()} />)

    expect(screen.getByTestId('slider')).toHaveValue('95')
  })
})
