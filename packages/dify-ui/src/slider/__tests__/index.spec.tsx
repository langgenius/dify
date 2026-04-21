import { render } from 'vitest-browser-react'
import { Slider } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Slider', () => {
  it('should render with correct default ARIA limits and current value', async () => {
    const screen = await render(<Slider value={50} onValueChange={vi.fn()} aria-label="Value" />)

    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('min', '0')
    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('max', '100')
    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('aria-valuenow', '50')
  })

  it('should apply custom min, max, and step values', async () => {
    const screen = await render(<Slider value={10} min={5} max={20} step={5} onValueChange={vi.fn()} aria-label="Value" />)

    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('min', '5')
    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('max', '20')
    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('aria-valuenow', '10')
  })

  it('should clamp non-finite values to min', async () => {
    const screen = await render(<Slider value={Number.NaN} min={5} onValueChange={vi.fn()} aria-label="Value" />)

    await expect.element(screen.getByLabelText('Value')).toHaveAttribute('aria-valuenow', '5')
  })

  it('should call onValueChange when arrow keys are pressed', async () => {
    const onValueChange = vi.fn()
    const screen = await render(<Slider value={20} onValueChange={onValueChange} aria-label="Value" />)

    const slider = screen.getByLabelText('Value').element()
    slider.focus()
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    await vi.waitFor(() => {
      expect(onValueChange).toHaveBeenCalledTimes(1)
    })
    expect(onValueChange).toHaveBeenLastCalledWith(21, expect.anything())
  })

  it('should round floating point keyboard updates to the configured step', async () => {
    const onValueChange = vi.fn()
    const screen = await render(<Slider value={0.2} min={0} max={1} step={0.1} onValueChange={onValueChange} aria-label="Value" />)

    const slider = screen.getByLabelText('Value').element()
    slider.focus()
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    await vi.waitFor(() => {
      expect(onValueChange).toHaveBeenCalledTimes(1)
    })
    expect(onValueChange).toHaveBeenLastCalledWith(0.3, expect.anything())
  })

  it('should not trigger onValueChange when disabled', async () => {
    const onValueChange = vi.fn()
    const screen = await render(<Slider value={20} onValueChange={onValueChange} disabled aria-label="Value" />)

    const slider = screen.getByLabelText('Value').element()
    expect(slider).toBeDisabled()

    asHTMLElement(slider).click()

    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('should apply custom class names on root', async () => {
    const screen = await render(<Slider value={10} onValueChange={vi.fn()} className="outer-test" aria-label="Value" />)

    expect(screen.container.querySelector('.outer-test')).toBeInTheDocument()
  })

  it('should not render prehydration script tags', async () => {
    const screen = await render(<Slider value={10} onValueChange={vi.fn()} aria-label="Value" />)

    expect(screen.container.querySelector('script')).not.toBeInTheDocument()
  })
})
