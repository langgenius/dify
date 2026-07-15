import type * as React from 'react'
import { render } from 'vitest-browser-react'
import { Field, FieldDescription, FieldError, FieldLabel } from '../../field'
import { Form } from '../../form'
import { Textarea } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement
const setTextareaValue = (element: HTMLElement | SVGElement, value: string) => {
  const textarea = asHTMLElement(element) as HTMLTextAreaElement
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set
  valueSetter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Textarea', () => {
  it('should render a labelled textarea through Base UI Field.Control', async () => {
    const screen = await render(
      <Field name="description">
        <FieldLabel>Description</FieldLabel>
        <Textarea defaultValue="A workspace for support automation." />
        <FieldDescription>Shown to workspace members.</FieldDescription>
      </Field>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Description' })

    await expect.element(textarea).toHaveValue('A workspace for support automation.')
    await expect.element(textarea).toHaveAccessibleDescription('Shown to workspace members.')
    expect(asHTMLElement(textarea.element()).tagName).toBe('TEXTAREA')
  })

  it('should apply custom classes', async () => {
    const screen = await render(
      <label>
        Prompt
        <Textarea size="large" className="resize-none" />
      </label>,
    )

    await expect.element(screen.getByRole('textbox', { name: 'Prompt' })).toHaveClass('resize-none')
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
        <Field name="summary">
          <FieldLabel>Summary</FieldLabel>
          <Textarea required minLength={10} />
          <FieldError match="valueMissing">Summary is required.</FieldError>
          <FieldError match="tooShort">Summary is too short.</FieldError>
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    const saveButton = asHTMLElement(screen.getByRole('button', { name: 'Save' }).element())
    saveButton.click()

    await vi.waitFor(async () => {
      await expect.element(screen.getByText('Summary is required.')).toBeInTheDocument()
      await expect
        .element(screen.getByRole('textbox', { name: 'Summary' }))
        .toHaveAttribute('aria-invalid', 'true')
    })
    expect(onFormSubmit).not.toHaveBeenCalled()

    await screen.rerender(
      <Form aria-label="dataset form" onFormSubmit={onFormSubmit}>
        <Field name="summary">
          <FieldLabel>Summary</FieldLabel>
          <Textarea
            key="valid-summary"
            required
            minLength={10}
            defaultValue="Long enough summary"
          />
          <FieldError match="valueMissing">Summary is required.</FieldError>
          <FieldError match="tooShort">Summary is too short.</FieldError>
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Save' }).element()).click()
    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({ summary: 'Long enough summary' })
  })

  it('should pass maxLength to the textarea without rendering a counter', async () => {
    const screen = await render(
      <label>
        Release notes
        <Textarea defaultValue="Draft" maxLength={20} />
      </label>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Release notes' })
    await expect.element(textarea).toHaveAttribute('maxLength', '20')
    expect(screen.container.textContent).not.toContain('5/20')
  })

  it('should route field props through Base UI Field.Control and textarea-only props to textarea', async () => {
    const onFormSubmit = vi.fn()
    const onBlur = vi.fn((event: React.FocusEvent<HTMLTextAreaElement>) => {
      expect(event.currentTarget.tagName).toBe('TEXTAREA')
    })
    const screen = await render(
      <Form aria-label="profile form" onFormSubmit={onFormSubmit}>
        <Field name="profileSummary">
          <FieldLabel>Profile summary</FieldLabel>
          <Textarea
            id="profile-summary"
            name="ignoredControlName"
            defaultValue="Long enough summary"
            rows={6}
            cols={40}
            wrap="soft"
            maxLength={80}
            onBlur={onBlur}
          />
        </Field>
        <Field disabled>
          <FieldLabel>Disabled note</FieldLabel>
          <Textarea name="disabledNote" defaultValue="Disabled value" />
        </Field>
        <button type="submit">Save</button>
      </Form>,
    )

    const profileSummary = screen.getByRole('textbox', { name: 'Profile summary' })
    expect(asHTMLElement(screen.getByText('Profile summary').element()).getAttribute('for')).toBe(
      'profile-summary',
    )
    await expect.element(profileSummary).toHaveAttribute('id', 'profile-summary')
    await expect.element(profileSummary).toHaveAttribute('name', 'profileSummary')
    await expect.element(profileSummary).toHaveAttribute('rows', '6')
    await expect.element(profileSummary).toHaveAttribute('cols', '40')
    await expect.element(profileSummary).toHaveAttribute('wrap', 'soft')
    await expect.element(profileSummary).toHaveAttribute('maxLength', '80')

    await expect.element(screen.getByRole('textbox', { name: 'Disabled note' })).toBeDisabled()

    asHTMLElement(profileSummary.element()).focus()
    const saveButton = asHTMLElement(screen.getByRole('button', { name: 'Save' }).element())
    saveButton.focus()
    expect(onBlur).toHaveBeenCalledTimes(1)

    saveButton.click()

    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({
      profileSummary: 'Long enough summary',
    })
    expect(onFormSubmit.mock.calls[0]?.[0]).not.toHaveProperty('ignoredControlName')
    expect(onFormSubmit.mock.calls[0]?.[0]).not.toHaveProperty('disabledNote')
  })
})
