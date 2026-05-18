import { render } from 'vitest-browser-react'
import { Checkbox } from '../../checkbox'
import { CheckboxGroup } from '../../checkbox-group'
import { FieldsetLegend, FieldsetRoot } from '../../fieldset'
import { Form } from '../../form'
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldItem,
  FieldLabel,
  FieldRoot,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Field primitives', () => {
  it('should associate label, description, and error with the control', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="profile form" onFormSubmit={onFormSubmit}>
        <FieldRoot name="email">
          <FieldLabel>Email</FieldLabel>
          <FieldControl type="email" required />
          <FieldDescription>Used for account notifications.</FieldDescription>
          <FieldError match="valueMissing">Email is required.</FieldError>
        </FieldRoot>
        <button type="submit">Save</button>
      </Form>,
    )

    const input = screen.getByRole('textbox', { name: 'Email' })

    await expect.element(input).toHaveAccessibleDescription('Used for account notifications.')
    await expect.element(input).toHaveClass('rounded-lg', 'system-sm-regular')

    asHTMLElement(screen.getByRole('button', { name: 'Save' }).element()).click()

    await vi.waitFor(async () => {
      await expect.element(screen.getByText('Email is required.')).toBeInTheDocument()
      await expect.element(input).toHaveAttribute('aria-invalid', 'true')
      await expect.element(input).toHaveClass('data-invalid:border-components-input-border-destructive')
    })
    expect(onFormSubmit).not.toHaveBeenCalled()
  })

  it('should submit valid field values through Base UI Form', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="settings form" onFormSubmit={onFormSubmit}>
        <FieldRoot name="apiKey">
          <FieldLabel>API key</FieldLabel>
          <FieldControl defaultValue="sk-test" required />
        </FieldRoot>
        <button type="submit">Save</button>
      </Form>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Save' }).element()).click()

    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({ apiKey: 'sk-test' })
  })

  it('should support external invalid state without requiring FieldControl', async () => {
    const screen = await render(
      <FieldRoot name="features" invalid>
        <FieldsetRoot render={<CheckboxGroup value={['search']} />}>
          <FieldsetLegend>Features</FieldsetLegend>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2">
              <Checkbox value="search" />
              Search
            </FieldLabel>
          </FieldItem>
          <FieldError match>Choose at least one feature.</FieldError>
        </FieldsetRoot>
      </FieldRoot>,
    )

    await expect.element(screen.getByRole('group', { name: 'Features' })).toBeInTheDocument()
    await expect.element(screen.getByRole('checkbox', { name: 'Search' })).toHaveAttribute('aria-checked', 'true')
    await expect.element(screen.getByText('Choose at least one feature.')).toHaveClass('text-text-destructive-secondary')
  })

  it('should apply large control sizing when requested', async () => {
    const screen = await render(
      <FieldRoot name="name">
        <FieldLabel>Name</FieldLabel>
        <FieldControl size="large" />
      </FieldRoot>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveClass('rounded-[10px]', 'system-md-regular')
  })
})
