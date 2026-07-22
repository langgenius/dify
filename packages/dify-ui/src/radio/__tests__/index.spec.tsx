import type { RadioGroupProps } from '../index'
import * as React from 'react'
import { render } from 'vitest-browser-react'
import { Field, FieldItem, FieldLabel } from '../../field'
import { Fieldset, FieldsetLegend } from '../../fieldset'
import { Radio, RadioControl, RadioGroup, RadioItem, RadioSkeleton } from '../index'

type TestRadioGroupProps<Value = string> = RadioGroupProps<Value> & {
  children: React.ReactNode
  label: string
  name?: string
}

function TestRadioGroup<Value = string>({
  children,
  label,
  name = 'radioField',
  ...props
}: TestRadioGroupProps<Value>) {
  return (
    <Field name={name}>
      <Fieldset render={<RadioGroup<Value> {...props} />}>
        <FieldsetLegend>{label}</FieldsetLegend>
        {children}
      </Fieldset>
    </Field>
  )
}

type TestRadioOptionProps = React.ComponentProps<typeof Radio> & {
  children: React.ReactNode
}

function TestRadioOption({ children, ...props }: TestRadioOptionProps) {
  return (
    <FieldItem>
      <FieldLabel>
        <Radio {...props} />
        {children}
      </FieldLabel>
    </FieldItem>
  )
}

function RadioTypeExamples() {
  return (
    <RadioGroup<boolean> value={true} onValueChange={() => {}}>
      <Radio<boolean> value={true} />
      <RadioItem<boolean> value={false} />
      {/* @ts-expect-error boolean radio items should not accept string values */}
      <Radio<boolean> value="true" />
      {/* @ts-expect-error boolean radio items should not accept string values */}
      <RadioItem<boolean> value="false" />
    </RadioGroup>
  )
}

void RadioTypeExamples

describe('RadioGroup', () => {
  it('should manage a controlled single selection', async () => {
    function StorageDemo() {
      const [value, setValue] = React.useState('ssd')

      return (
        <TestRadioGroup value={value} onValueChange={setValue} label="Storage type">
          <TestRadioOption value="ssd">SSD</TestRadioOption>
          <TestRadioOption value="hdd">HDD</TestRadioOption>
        </TestRadioGroup>
      )
    }

    const screen = await render(<StorageDemo />)

    await expect
      .element(screen.getByRole('radio', { name: 'SSD' }))
      .toHaveAttribute('aria-checked', 'true')

    await screen.getByRole('radio', { name: 'HDD' }).click()

    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole('radio', { name: 'SSD' }))
        .toHaveAttribute('aria-checked', 'false')
      await expect
        .element(screen.getByRole('radio', { name: 'HDD' }))
        .toHaveAttribute('aria-checked', 'true')
    })
  })

  it('should compose with Dify UI Field and Fieldset without losing labels', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <TestRadioGroup value="ssd" onValueChange={onValueChange} label="Storage type">
        <TestRadioOption value="ssd">SSD</TestRadioOption>
        <TestRadioOption value="hdd">HDD</TestRadioOption>
      </TestRadioGroup>,
    )

    await expect
      .element(screen.getByRole('radiogroup', { name: 'Storage type' }))
      .toBeInTheDocument()

    const hdd = screen.getByRole('radio', { name: 'HDD' })
    await expect.element(hdd).toHaveAttribute('aria-checked', 'false')

    await hdd.click()

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange.mock.calls[0]?.[0]).toBe('hdd')
  })
})

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

    await screen.getByRole('radio', { name: 'HDD' }).click()

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange.mock.calls[0]?.[0]).toBe('hdd')
    await expect
      .element(screen.getByRole('radio', { name: 'HDD' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('should expose disabled semantics', async () => {
    const screen = await render(
      <TestRadioGroup defaultValue="ssd" label="Storage type">
        <TestRadioOption value="ssd">SSD</TestRadioOption>
        <TestRadioOption value="hdd" disabled>
          HDD
        </TestRadioOption>
      </TestRadioGroup>,
    )

    const hdd = screen.getByRole('radio', { name: 'HDD' })
    await expect.element(hdd).toHaveAttribute('data-disabled', '')
    await expect.element(hdd).toHaveAttribute('aria-disabled', 'true')
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
    if (!form) return

    const data = new FormData(form)

    expect(data.get('storageType')).toBe('ssd')
  })

  it('should support custom items with a visual RadioControl', async () => {
    const screen = await render(
      <RadioGroup defaultValue="card" aria-label="Card choice">
        <RadioItem
          value="card"
          nativeButton
          render={<button type="button" className="custom-card" />}
        >
          <span>Card option</span>
          <RadioControl className="custom-control" />
        </RadioItem>
      </RadioGroup>,
    )

    await expect
      .element(screen.getByRole('radio', { name: 'Card option' }))
      .toHaveClass('custom-card')
    expect(screen.container.querySelector('.custom-control')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('radio', { name: 'Card option' }))
      .toHaveAttribute('data-checked', '')
  })
})

describe('RadioSkeleton', () => {
  it('should render a visual placeholder without radio semantics', async () => {
    const screen = await render(<RadioSkeleton />)

    expect(screen.container.querySelector('[role="radio"]')).not.toBeInTheDocument()
  })
})
