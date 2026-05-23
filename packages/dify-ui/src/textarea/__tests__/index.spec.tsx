import { render } from 'vitest-browser-react'
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from '../../field'
import { Form } from '../../form'
import { Textarea } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement
const setTextareaValue = (element: HTMLElement | SVGElement, value: string) => {
  const textarea = asHTMLElement(element) as HTMLTextAreaElement
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  valueSetter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Textarea', () => {
  it('should render a labelled textarea through Base UI Field.Control', async () => {
    const screen = await render(
      <FieldRoot name="description">
        <FieldLabel>Description</FieldLabel>
        <Textarea defaultValue="A workspace for support automation." />
        <FieldDescription>Shown to workspace members.</FieldDescription>
      </FieldRoot>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Description' })

    await expect.element(textarea).toHaveValue('A workspace for support automation.')
    await expect.element(textarea).toHaveAccessibleDescription('Shown to workspace members.')
    await expect.element(textarea).toHaveClass('min-h-20', 'rounded-lg', 'system-sm-regular')
    expect(asHTMLElement(textarea.element()).tagName).toBe('TEXTAREA')
  })

  it('should apply size variants and custom classes', async () => {
    const screen = await render(
      <label>
        Prompt
        <Textarea size="large" className="resize-none" />
      </label>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Prompt' })).toHaveClass(
      'rounded-[10px]',
      'px-4',
      'py-2',
      'system-md-regular',
      'resize-none',
    )
  })

  it('should call onValueChange and stay controlled until value changes', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <label>
        Notes
        <Textarea value="" onValueChange={onValueChange} />
      </label>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Notes' })
    setTextareaValue(textarea.element(), 'a')

    expect(onValueChange).toHaveBeenCalledWith('a', expect.any(Object))
    await expect.element(textarea).toHaveValue('')

    await screen.rerender(
      <label>
        Notes
        <Textarea value="a" onValueChange={onValueChange} />
      </label>,
    )
    await expect.element(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('a')
  })

  it('should submit valid values and show validation errors through Base UI Form', async () => {
    const onFormSubmit = vi.fn()
    const screen = await render(
      <Form aria-label="dataset form" onFormSubmit={onFormSubmit}>
        <FieldRoot name="summary">
          <FieldLabel>Summary</FieldLabel>
          <Textarea required minLength={10} />
          <FieldError match="valueMissing">Summary is required.</FieldError>
          <FieldError match="tooShort">Summary is too short.</FieldError>
        </FieldRoot>
        <button type="submit">Save</button>
      </Form>,
    )

    const saveButton = asHTMLElement(screen.getByRole('button', { name: 'Save' }).element())
    saveButton.click()

    await vi.waitFor(async () => {
      await expect.element(screen.getByText('Summary is required.')).toBeInTheDocument()
      await expect.element(screen.getByRole('textbox', { name: 'Summary' })).toHaveAttribute('aria-invalid', 'true')
    })
    expect(onFormSubmit).not.toHaveBeenCalled()

    await screen.rerender(
      <Form aria-label="dataset form" onFormSubmit={onFormSubmit}>
        <FieldRoot name="summary">
          <FieldLabel>Summary</FieldLabel>
          <Textarea key="valid-summary" required minLength={10} defaultValue="Long enough summary" />
          <FieldError match="valueMissing">Summary is required.</FieldError>
          <FieldError match="tooShort">Summary is too short.</FieldError>
        </FieldRoot>
        <button type="submit">Save</button>
      </Form>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Save' }).element()).click()
    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({ summary: 'Long enough summary' })
  })

  it('should render character count when maxLength is set', async () => {
    const screen = await render(
      <label>
        Release notes
        <Textarea defaultValue="Draft" maxLength={20} />
      </label>,
    )

    await expect.element(screen.getByText('5/20')).toBeInTheDocument()
    await expect.element(screen.getByRole('textbox', { name: 'Release notes' })).toHaveClass('pb-7')
  })
})
