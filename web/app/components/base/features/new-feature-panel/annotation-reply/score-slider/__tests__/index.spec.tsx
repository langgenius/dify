import { render, screen } from '@testing-library/react'
import ScoreSlider from '../index'

describe('ScoreSlider', () => {
  const getSliderInput = () => screen.getByLabelText('appDebug.feature.annotation.scoreThreshold.title')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the slider', () => {
    render(<ScoreSlider value={90} onChange={vi.fn()} />)

    expect(getSliderInput()).toBeInTheDocument()
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

    expect(getSliderInput()).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should pass value to the slider', () => {
    render(<ScoreSlider value={95} onChange={vi.fn()} />)

    expect(getSliderInput()).toHaveValue('95')
    expect(screen.getByText('0.95')).toBeInTheDocument()
  })
})
