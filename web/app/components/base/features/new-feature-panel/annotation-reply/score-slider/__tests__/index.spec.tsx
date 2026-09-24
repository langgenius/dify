import { render, screen } from '@testing-library/react'
import ScoreSlider from '..'

describe('ScoreSlider', () => {
  it('should expose the business score instead of the internal percentage', () => {
    render(<ScoreSlider value={90} onChange={vi.fn()} />)

    const slider = screen.getByRole('slider', {
      name: 'appDebug.feature.annotation.scoreThreshold.title',
    })
    expect(slider).toHaveAttribute('aria-valuenow', '90')
    expect(slider).toHaveAttribute('aria-valuetext', '0.90')
    expect(screen.getByText('0.90')).toBeInTheDocument()
  })
})
