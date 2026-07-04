import type * as React from 'react'
import { render } from 'vitest-browser-react'
import { FieldItem, FieldLabel, FieldRoot } from '../../field'
import { FieldsetLegend, FieldsetRoot } from '../../fieldset'
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

type TestRadioGroupProps = React.ComponentProps<typeof RadioGroup> & {
  children: React.ReactNode
  label: string
  name?: string
}

function TestRadioGroup({
  children,
  label,
  name = 'radioField',
  ...props
}: TestRadioGroupProps) {
  return (
    <FieldRoot name={name}>
      <FieldsetRoot render={<RadioGroup {...props} />}>
        <FieldsetLegend>{label}</FieldsetLegend>
        {children}
      </FieldsetRoot>
    </FieldRoot>
  )
}

type TestRadioOptionProps = React.ComponentProps<typeof Radio> & {
  children: React.ReactNode
}

function TestRadioOption({
  children,
  ...props
}: TestRadioOptionProps) {
  return (
    <FieldItem>
      <FieldLabel>
        <Radio {...props} />
        {children}
      </FieldLabel>
    </FieldItem>
  )
}

describe('Radio', () => {
  it('should render unchecked and checked radios with Base UI semantics', async () => {
    const screen = await render(
      <TestRadioGroup defaultValue="ssd" label="Storage type">
        <TestRadioOption value="ssd">SSD</TestRadioOption>
        <TestRadioOption value="hdd">HDD</TestRadioOption>
      </TestRadioGroup>,
    )

    const ssd = screen.getByRole('radio', { name: 'SSD' })
    const hdd = screen.getByRole('radio', { name: 'HDD' })

    await expect.element(ssd).toHaveAttribute('aria-checked', 'true')
    await expect.element(ssd).toHaveAttribute('data-checked', '')
    await expect.element(hdd).toHaveAttribute('aria-checked', 'false')
    await expect.element(hdd).toHaveAttribute('data-unchecked', '')
  })

  it('should call onValueChange and update uncontrolled state when selected', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <TestRadioGroup defaultValue="ssd" label="Storage type" onValueChange={onValueChange}>
        <TestRadioOption value="ssd">SSD</TestRadioOption>
        <TestRadioOption value="hdd">HDD</TestRadioOption>
      </TestRadioGroup>,
    )

    clickElement(screen.getByRole('radio', { name: 'HDD' }).element())

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange.mock.calls[0]?.[0]).toBe('hdd')
    await expect.element(screen.getByRole('radio', { name: 'HDD' })).toHaveAttribute('aria-checked', 'true')
  })

  it('should ignore interaction when disabled', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <TestRadioGroup defaultValue="ssd" label="Storage type" onValueChange={onValueChange}>
        <TestRadioOption value="ssd">SSD</TestRadioOption>
        <TestRadioOption value="hdd" disabled>HDD</TestRadioOption>
      </TestRadioGroup>,
    )

    const hdd = screen.getByRole('radio', { name: 'HDD' })
    await expect.element(hdd).toHaveAttribute('data-disabled', '')

    clickElement(hdd.element())

    expect(onValueChange).not.toHaveBeenCalled()
    await expect.element(hdd).toHaveAttribute('aria-checked', 'false')
  })

  it('should submit the selected group value through the hidden input', async () => {
    const screen = await render(
      <form>
        <TestRadioGroup defaultValue="ssd" label="Storage type" name="storageType">
          <TestRadioOption value="ssd">SSD</TestRadioOption>
          <TestRadioOption value="hdd">HDD</TestRadioOption>
        </TestRadioGroup>
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
      <TestRadioGroup defaultValue="custom" label="Custom">
        <FieldItem>
          <FieldLabel>
            <RadioRoot value="custom" className="custom-root">
              <RadioIndicator className="custom-indicator" keepMounted />
            </RadioRoot>
            Custom
          </FieldLabel>
        </FieldItem>
      </TestRadioGroup>,
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
    const screen = await render(<RadioSkeleton />)

    expect(screen.container.querySelector('[role="radio"]')).not.toBeInTheDocument()
  })
})
