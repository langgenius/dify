import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from '../index'

describe('Slider', () => {
  const getSliderInput = () => screen.getByLabelText('Value')

  it('should render with correct default ARIA limits and current value', () => {
    render(<Slider value={50} onValueChange={vi.fn()} aria-label="Value" />)

    const slider = getSliderInput()
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
  })

  it('should apply custom min, max, and step values', () => {
    render(<Slider value={10} min={5} max={20} step={5} onValueChange={vi.fn()} aria-label="Value" />)

    const slider = getSliderInput()
    expect(slider).toHaveAttribute('min', '5')
    expect(slider).toHaveAttribute('max', '20')
    expect(slider).toHaveAttribute('aria-valuenow', '10')
  })

  it('should clamp non-finite values to min', () => {
    render(<Slider value={Number.NaN} min={5} onValueChange={vi.fn()} aria-label="Value" />)

    expect(getSliderInput()).toHaveAttribute('aria-valuenow', '5')
  })

  it('should call onValueChange when arrow keys are pressed', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(<Slider value={20} onValueChange={onValueChange} aria-label="Value" />)

    const slider = getSliderInput()

    await act(async () => {
      slider.focus()
      await user.keyboard('{ArrowRight}')
    })

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenLastCalledWith(21, expect.anything())
  })

  it('should round floating point keyboard updates to the configured step', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(<Slider value={0.2} min={0} max={1} step={0.1} onValueChange={onValueChange} aria-label="Value" />)

    const slider = getSliderInput()

    await act(async () => {
      slider.focus()
      await user.keyboard('{ArrowRight}')
    })

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenLastCalledWith(0.3, expect.anything())
  })

  it('should not trigger onValueChange when disabled', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Slider value={20} onValueChange={onValueChange} disabled aria-label="Value" />)

    const slider = getSliderInput()

    expect(slider).toBeDisabled()

    await act(async () => {
      slider.focus()
      await user.keyboard('{ArrowRight}')
    })

    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('should apply custom class names on root', () => {
    const { container } = render(<Slider value={10} onValueChange={vi.fn()} className="outer-test" aria-label="Value" />)

    const sliderWrapper = container.querySelector('.outer-test')
    expect(sliderWrapper).toBeInTheDocument()
  })

  it('should not render prehydration script tags', () => {
    const { container } = render(<Slider value={10} onValueChange={vi.fn()} aria-label="Value" />)

    expect(container.querySelector('script')).not.toBeInTheDocument()
  })
})
