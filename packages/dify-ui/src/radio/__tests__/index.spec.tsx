import { render } from 'vitest-browser-react'
import { RadioGroup } from '../../radio-group'
import {
  Radio,
  RadioControl,
  RadioIndicator,
  RadioRoot,
  RadioSkeleton,
} from '../index'

const clickElement = (element: HTMLElement | SVGElement) => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('Radio', () => {
  it('should render unchecked and checked radios with Base UI semantics', async () => {
    const screen = await render(
      <RadioGroup defaultValue="ssd" aria-label="Storage type">
        <label>
          <Radio value="ssd" />
          SSD
        </label>
        <label>
          <Radio value="hdd" />
          HDD
        </label>
      </RadioGroup>,
    )

    const ssd = screen.getByRole('radio', { name: 'SSD' })
    const hdd = screen.getByRole('radio', { name: 'HDD' })

    await expect.element(ssd).toHaveAttribute('aria-checked', 'true')
    await expect.element(ssd).toHaveAttribute('data-checked', '')
    await expect.element(ssd).toHaveClass('data-checked:border-components-radio-border-checked')
    await expect.element(hdd).toHaveAttribute('aria-checked', 'false')
    await expect.element(hdd).toHaveAttribute('data-unchecked', '')
  })

  it('should call onValueChange and update uncontrolled state when selected', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <RadioGroup defaultValue="ssd" aria-label="Storage type" onValueChange={onValueChange}>
        <label>
          <Radio value="ssd" />
          SSD
        </label>
        <label>
          <Radio value="hdd" />
          HDD
        </label>
      </RadioGroup>,
    )

    clickElement(screen.getByRole('radio', { name: 'HDD' }).element())

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange.mock.calls[0]?.[0]).toBe('hdd')
    await expect.element(screen.getByRole('radio', { name: 'HDD' })).toHaveAttribute('aria-checked', 'true')
  })

  it('should ignore interaction when disabled', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <RadioGroup defaultValue="ssd" aria-label="Storage type" onValueChange={onValueChange}>
        <label>
          <Radio value="ssd" />
          SSD
        </label>
        <label>
          <Radio value="hdd" disabled />
          HDD
        </label>
      </RadioGroup>,
    )

    const hdd = screen.getByRole('radio', { name: 'HDD' })
    await expect.element(hdd).toHaveAttribute('data-disabled', '')
    await expect.element(hdd).toHaveClass('data-disabled:cursor-not-allowed')

    clickElement(hdd.element())

    expect(onValueChange).not.toHaveBeenCalled()
    await expect.element(hdd).toHaveAttribute('aria-checked', 'false')
  })

  it('should submit the selected group value through the hidden input', async () => {
    const screen = await render(
      <form>
        <RadioGroup defaultValue="ssd" name="storageType" aria-label="Storage type">
          <label>
            <Radio value="ssd" />
            SSD
          </label>
          <label>
            <Radio value="hdd" />
            HDD
          </label>
        </RadioGroup>
      </form>,
    )
    const form = screen.container.querySelector<HTMLFormElement>('form')
    expect(form).not.toBeNull()
    if (!form)
      return

    const data = new FormData(form)

    expect(data.get('storageType')).toBe('ssd')
  })

  it('should support custom compound composition with RadioRoot and RadioIndicator', async () => {
    const screen = await render(
      <RadioGroup defaultValue="custom" aria-label="Custom">
        <label>
          <RadioRoot value="custom" className="custom-root">
            <RadioIndicator className="custom-indicator" keepMounted />
          </RadioRoot>
          Custom
        </label>
      </RadioGroup>,
    )

    await expect.element(screen.getByRole('radio', { name: 'Custom' })).toHaveClass('custom-root')
    expect(screen.container.querySelector('.custom-indicator')).toBeInTheDocument()
  })

  it('should support unstyled roots with a visual RadioControl for option cards', async () => {
    const screen = await render(
      <RadioGroup defaultValue="card" aria-label="Card choice">
        <RadioRoot
          value="card"
          variant="unstyled"
          nativeButton
          render={<button type="button" className="custom-card" />}
        >
          <span>Card option</span>
          <RadioControl className="custom-control" />
        </RadioRoot>
      </RadioGroup>,
    )

    await expect.element(screen.getByRole('radio', { name: 'Card option' })).toHaveClass('custom-card')
    expect(screen.container.querySelector('.custom-control')).toBeInTheDocument()
    await expect.element(screen.getByRole('radio', { name: 'Card option' })).toHaveAttribute('data-checked', '')
  })
})

describe('RadioSkeleton', () => {
  it('should render a visual placeholder without radio semantics', async () => {
    const screen = await render(<RadioSkeleton data-testid="radio-skeleton" />)

    expect(screen.container.querySelector('[role="radio"]')).not.toBeInTheDocument()
    await expect.element(screen.getByTestId('radio-skeleton')).toHaveClass('rounded-full', 'opacity-20')
  })
})
