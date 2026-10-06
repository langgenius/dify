import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScoreSlider from '..'

describe('ScoreSlider', () => {
  it('should display and update the score with two decimal places', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<ScoreSlider value={0.9} onChange={onChange} />)

    const slider = screen.getByRole('slider', {
      name: 'appDebug.feature.annotation.scoreThreshold.title',
    })
    expect(slider).toHaveAttribute('aria-valuenow', '0.9')
    expect(slider).toHaveAttribute('aria-valuetext', '0.90')
    expect(screen.getByRole('status')).toHaveTextContent('0.90')
    expect(screen.getByRole('status')).toHaveAttribute('for', slider.id)
    act(() => slider.focus())
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith(0.91, expect.anything())
    rerender(<ScoreSlider value={0.91} onChange={onChange} />)
    expect(screen.getByRole('status')).toHaveTextContent('0.91')
    expect(slider).toHaveAttribute('aria-valuetext', '0.91')
  })

  it.each([
    ['{PageUp}', 0.6],
    ['{PageDown}', 0.4],
    ['{Shift>}{ArrowRight}{/Shift}', 0.6],
    ['{Shift>}{ArrowLeft}{/Shift}', 0.4],
  ])('should adjust the score by 0.10 with %s', async (key, expectedValue) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ScoreSlider value={0.5} onChange={onChange} />)

    const slider = screen.getByRole('slider', {
      name: 'appDebug.feature.annotation.scoreThreshold.title',
    })
    act(() => slider.focus())
    await user.keyboard(key)

    expect(onChange).toHaveBeenCalledWith(expectedValue, expect.anything())
  })
})
