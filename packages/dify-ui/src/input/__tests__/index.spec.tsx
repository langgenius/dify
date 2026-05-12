import { render } from 'vitest-browser-react'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '../../field'
import { Form } from '../../form'
import { Input } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Input', () => {
  it('should render a labelled Base UI input with design-system classes', async () => {
    const screen = await render(
      <label>
        Workspace name
        <Input name="workspaceName" defaultValue="Dify" />
      </label>,
    )

    const input = screen.getByRole('textbox', { name: 'Workspace name' })

    await expect.element(input).toHaveValue('Dify')
    await expect.element(input).toHaveClass('rounded-lg', 'py-[7px]', 'system-sm-regular')
  })

  it('should apply size variants shared with FieldControl', async () => {
    const screen = await render(
      <>
        <label>
          Small input
          <Input size="small" />
        </label>
        <div>
          Large field
          <FieldRoot name="largeField">
            <FieldLabel>Large field</FieldLabel>
            <FieldControl size="large" />
          </FieldRoot>
        </div>
      </>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Small input' })).toHaveClass('rounded-md', 'py-[3px]', 'system-xs-regular')
    await expect.element(screen.getByRole('textbox', { name: 'Large field' })).toHaveClass('rounded-[10px]', 'py-[7px]', 'system-md-regular')
  })

  it('should use FieldRoot invalid state', async () => {
    const screen = await render(
      <FieldRoot name="repositoryUrl" invalid>
        <FieldLabel>Repository URL</FieldLabel>
        <Input defaultValue="github.com/langgenius" />
      </FieldRoot>,
    )

    const input = screen.getByRole('textbox', { name: 'Repository URL' })

    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    await expect.element(input).toHaveAttribute('data-invalid')
    await expect.element(input).toHaveClass('data-invalid:border-components-input-border-destructive')
  })

  it('should integrate with FieldRoot and Base UI Form validation', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="account form" onFormSubmit={onFormSubmit}>
        <FieldRoot name="email">
          <FieldLabel>Email</FieldLabel>
          <Input type="email" required />
          <FieldError match="valueMissing">Email is required.</FieldError>
        </FieldRoot>
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
