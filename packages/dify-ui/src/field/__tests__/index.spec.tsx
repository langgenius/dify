import { render } from 'vitest-browser-react'
import { Checkbox } from '../../checkbox'
import { CheckboxGroup } from '../../checkbox-group'
import { Fieldset, FieldsetLegend } from '../../fieldset'
import { Form } from '../../form'
import { Field, FieldControl, FieldDescription, FieldError, FieldItem, FieldLabel } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Field primitives', () => {
  it('should associate label, description, and error with the control', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="profile form" onFormSubmit={onFormSubmit}>
        <Field name="email">
          <FieldLabel>Email</FieldLabel>
          <FieldControl type="email" required />
          <FieldDescription>Used for account notifications.</FieldDescription>
          <FieldError match="valueMissing">Email is required.</FieldError>
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    const input = screen.getByRole('textbox', { name: 'Email' })
    const label = asHTMLElement(screen.getByText('Email').element())
    const description = asHTMLElement(screen.getByText('Used for account notifications.').element())

    await expect.element(input).toHaveAccessibleDescription('Used for account notifications.')
    expect(label.tagName).toBe('LABEL')
    expect(label).toHaveAttribute('for', asHTMLElement(input.element()).id)
    expect(asHTMLElement(input.element()).getAttribute('aria-describedby')?.split(' ')).toContain(
      description.id,
    )

    await screen.getByRole('button', { name: 'Save' }).click()

    await vi.waitFor(async () => {
      const error = asHTMLElement(screen.getByText('Email is required.').element())
      await expect.element(screen.getByText('Email is required.')).toBeInTheDocument()
      await expect.element(input).toHaveAttribute('aria-invalid', 'true')
      expect(asHTMLElement(input.element()).getAttribute('aria-describedby')?.split(' ')).toEqual(
        expect.arrayContaining([description.id, error.id]),
      )
    })
    expect(onFormSubmit).not.toHaveBeenCalled()
  })

  it('should submit valid field values through Base UI Form', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="settings form" onFormSubmit={onFormSubmit}>
        <Field name="apiKey">
          <FieldLabel>API key</FieldLabel>
          <FieldControl defaultValue="sk-test" required />
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    await screen.getByRole('button', { name: 'Save' }).click()

    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({ apiKey: 'sk-test' })
  })

  it('should support external invalid state without requiring FieldControl', async () => {
    const screen = await render(
      <Field name="features" invalid>
        <Fieldset render={<CheckboxGroup value={['search']} />}>
          <FieldsetLegend>Features</FieldsetLegend>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2">
              <Checkbox value="search" />
              Search
            </FieldLabel>
          </FieldItem>
          <FieldError match>Choose at least one feature.</FieldError>
        </Fieldset>
      </Field>,
    )

    await expect.element(screen.getByRole('group', { name: 'Features' })).toBeInTheDocument()
    await expect
      .element(screen.getByRole('checkbox', { name: 'Search' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('should expose the read-only state', async () => {
    const screen = await render(
      <Field name="token">
        <FieldLabel>Token</FieldLabel>
        <FieldControl readOnly defaultValue="readonly-token" />
      </Field>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Token' })).toHaveAttribute('readonly')
  })
})
