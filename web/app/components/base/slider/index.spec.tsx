import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Slider from './index'

describe('Slider Component', () => {
  it('should render with correct default ARIA limits and current value', () => {
    render(<Slider value={50} onChange={vi.fn()} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
  })

  it('should apply custom min, max, and step values', () => {
    render(<Slider value={10} min={5} max={20} step={5} onChange={vi.fn()} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '5')
    expect(slider).toHaveAttribute('aria-valuemax', '20')
    expect(slider).toHaveAttribute('aria-valuenow', '10')
  })

  it('should default to 0 if the value prop is NaN', () => {
    render(<Slider value={Number.NaN} onChange={vi.fn()} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '0')
  })

  it('should call onChange when arrow keys are pressed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Slider value={20} onChange={onChange} />)

    const slider = screen.getByRole('slider')

    await act(async () => {
      slider.focus()
      await user.keyboard('{ArrowRight}')
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(21, 0)
  })

  it('should not trigger onChange when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Slider value={20} onChange={onChange} disabled />)

    const slider = screen.getByRole('slider')

    expect(slider).toHaveAttribute('aria-disabled', 'true')

    await act(async () => {
      slider.focus()
      await user.keyboard('{ArrowRight}')
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('should apply custom class names', () => {
    render(
      <Slider value={10} onChange={vi.fn()} className="outer-test" thumbClassName="thumb-test" />,
    )

    const sliderWrapper = screen.getByRole('slider').closest('.outer-test')
    expect(sliderWrapper).toBeInTheDocument()

    const thumb = screen.getByRole('slider')
    expect(thumb).toHaveClass('thumb-test')
  })
})
