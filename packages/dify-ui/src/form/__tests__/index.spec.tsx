import { render } from 'vitest-browser-react'
import { FieldControl, FieldLabel, FieldRoot } from '../../field'
import { Form } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Form primitive', () => {
  it('should render a native named form and merge custom class names', async () => {
    const screen = await render(
      <Form aria-label="profile form" className="custom-form">
        <FieldRoot name="name">
          <FieldLabel>Name</FieldLabel>
          <FieldControl defaultValue="Ada" />
        </FieldRoot>
      </Form>,
    )

    await expect.element(screen.getByRole('form', { name: 'profile form' })).toHaveClass('custom-form')
  })

  it('should call onFormSubmit with submitted values', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="api form" onFormSubmit={onFormSubmit}>
        <FieldRoot name="endpoint">
          <FieldLabel>Endpoint</FieldLabel>
          <FieldControl defaultValue="https://api.example.com" />
        </FieldRoot>
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
        <FieldRoot name="token">
          <FieldLabel>Token</FieldLabel>
          <FieldControl defaultValue="expired" />
        </FieldRoot>
      </Form>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Token' })).toHaveAttribute('aria-invalid', 'true')
  })
})
