import { render } from 'vitest-browser-react'
import { Field, FieldError, FieldLabel } from '../../field'
import { Form } from '../../form'
import { Input } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Input', () => {
  it('should render a labelled Base UI input with its value', async () => {
    const screen = await render(
      <label>
        Workspace name
        <Input name="workspaceName" defaultValue="Dify" />
      </label>,
    )

    const input = screen.getByRole('textbox', { name: 'Workspace name' })

    await expect.element(input).toHaveValue('Dify')
  })

  it('should use Field invalid state', async () => {
    const screen = await render(
      <Field name="repositoryUrl" invalid>
        <FieldLabel>Repository URL</FieldLabel>
        <Input defaultValue="github.com/langgenius" />
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Repository URL' })

    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    await expect.element(input).toHaveAttribute('data-invalid')
  })

  it('should integrate with Field and Base UI Form validation', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="account form" onFormSubmit={onFormSubmit}>
        <Field name="email">
          <FieldLabel>Email</FieldLabel>
          <Input type="email" required />
          <FieldError match="valueMissing">Email is required.</FieldError>
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    const input = screen.getByRole('textbox', { name: 'Email' })

    asHTMLElement(screen.getByRole('button', { name: 'Save' }).element()).click()

    await vi.waitFor(async () => {
      await expect.element(screen.getByText('Email is required.')).toBeInTheDocument()
      await expect.element(input).toHaveAttribute('aria-invalid', 'true')
      await expect.element(input).toHaveAttribute('data-invalid')
    })
    expect(onFormSubmit).not.toHaveBeenCalled()
  })
})
