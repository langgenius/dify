import type { SliderProps, SliderThumbProps } from '../index'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

type TestSliderProps = SliderProps<number> & {
  label?: string
  thumbProps?: SliderThumbProps
}

function TestSlider({ label = 'Value', thumbProps, ...props }: TestSliderProps) {
  return (
    <Slider {...props}>
      <SliderLabel>{label}</SliderLabel>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb {...thumbProps} />
        </SliderTrack>
      </SliderControl>
    </Slider>
  )
}

describe('Slider', () => {
  it('should render with correct default ARIA limits and current value', async () => {
    const screen = await render(<TestSlider value={50} onValueChange={vi.fn()} />)

    const slider = screen.getByRole('slider', { name: 'Value' })

    await expect.element(slider).toHaveAttribute('min', '0')
    await expect.element(slider).toHaveAttribute('max', '100')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
  })

  it('should apply custom min, max, and step values', async () => {
    const screen = await render(
      <TestSlider value={10} min={5} max={20} step={5} onValueChange={vi.fn()} />,
    )

    const slider = screen.getByRole('slider', { name: 'Value' })

    await expect.element(slider).toHaveAttribute('min', '5')
    await expect.element(slider).toHaveAttribute('max', '20')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '10')
  })

  it('should call onValueChange when arrow keys are pressed', async () => {
    const onValueChange = vi.fn()
    const screen = await render(<TestSlider value={20} onValueChange={onValueChange} />)

    const slider = screen.getByRole('slider', { name: 'Value' })
    asHTMLElement(slider.element()).focus()
    await userEvent.keyboard('{ArrowRight}')

    await vi.waitFor(() => {
      expect(onValueChange).toHaveBeenCalledTimes(1)
    })
    expect(onValueChange).toHaveBeenLastCalledWith(21, expect.anything())
  })

  it('should round floating point keyboard updates to the configured step', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <TestSlider value={0.2} min={0} max={1} step={0.1} onValueChange={onValueChange} />,
    )

    const slider = screen.getByRole('slider', { name: 'Value' })
    asHTMLElement(slider.element()).focus()
    await userEvent.keyboard('{ArrowRight}')

    await vi.waitFor(() => {
      expect(onValueChange).toHaveBeenCalledTimes(1)
    })
    expect(onValueChange).toHaveBeenLastCalledWith(0.3, expect.anything())
  })

  it('should not trigger onValueChange when disabled', async () => {
    const screen = await render(<TestSlider value={20} disabled />)
    const slider = screen.getByRole('slider', { name: 'Value' })

    await expect.element(slider).toBeDisabled()
    expect(slider.element().parentElement).toHaveAttribute('data-disabled')
    expect(screen.container.querySelector('[role="group"]')).toHaveAttribute('data-disabled')
  })

  it('should expose vertical orientation through native state attributes', async () => {
    const screen = await render(<TestSlider value={20} orientation="vertical" />)
    const slider = screen.getByRole('slider', { name: 'Value' })

    await expect.element(slider).toHaveAttribute('aria-orientation', 'vertical')
    expect(slider.element().parentElement).toHaveAttribute('data-orientation', 'vertical')
    expect(screen.container.querySelector('[role="group"]')).toHaveAttribute(
      'data-orientation',
      'vertical',
    )
  })

  it('should not render prehydration script tags', async () => {
    const screen = await render(<TestSlider value={10} onValueChange={vi.fn()} />)

    expect(screen.container.querySelector('script')).not.toBeInTheDocument()
  })

  it('should forward thumb value text to the range input', async () => {
    const screen = await render(
      <TestSlider
        defaultValue={50}
        label="Temperature"
        thumbProps={{ 'aria-valuetext': '50 degrees' }}
      />,
    )

    await expect
      .element(screen.getByRole('slider', { name: 'Temperature' }))
      .toHaveAttribute('aria-valuetext', '50 degrees')
  })
})
