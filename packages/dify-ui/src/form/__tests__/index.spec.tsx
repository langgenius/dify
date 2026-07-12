import { render } from 'vitest-browser-react'
import { Field, FieldControl, FieldLabel } from '../../field'
import { Form } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Form primitive', () => {
  it('should render a native named form and merge custom class names', async () => {
    const screen = await render(
      <Form aria-label="profile form" className="custom-form">
        <Field name="name">
          <FieldLabel>Name</FieldLabel>
          <FieldControl defaultValue="Ada" />
        </Field>
      </Form>,
    )

    await expect.element(screen.getByRole('form', { name: 'profile form' })).toHaveClass('custom-form')
  })

  it('should call onFormSubmit with submitted values', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="api form" onFormSubmit={onFormSubmit}>
        <Field name="endpoint">
          <FieldLabel>Endpoint</FieldLabel>
          <FieldControl defaultValue="https://api.example.com" />
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Save' }).element()).click()

    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({
      endpoint: 'https://api.example.com',
    })
  })

  it('should expose externally supplied errors through FieldError consumers', async () => {
    const screen = await render(
      <Form aria-label="server form" errors={{ token: 'Token has expired.' }}>
        <Field name="token">
          <FieldLabel>Token</FieldLabel>
          <FieldControl defaultValue="expired" />
        </Field>
      </Form>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Token' })).toHaveAttribute('aria-invalid', 'true')
  })
})
