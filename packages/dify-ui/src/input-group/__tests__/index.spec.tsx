import { render } from 'vitest-browser-react'
import { Button } from '../../button'
import { Field, FieldLabel } from '../../field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../index'

describe('InputGroup', () => {
  it('should project Field state onto the grouped surface', async () => {
    const screen = await render(
      <Field name="repositoryUrl" invalid>
        <FieldLabel>Repository URL</FieldLabel>
        <InputGroup data-testid="group">
          <InputGroupInput defaultValue="github.com/langgenius" />
          <InputGroupAddon>https://</InputGroupAddon>
        </InputGroup>
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Repository URL' })

    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    expect(getComputedStyle(input.element()).borderTopWidth).toBe('0px')
    expect(getComputedStyle(input.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('should preserve an interactive add-on as the focus owner', async () => {
    const onCopy = vi.fn()
    const screen = await render(
      <InputGroup data-testid="group">
        <InputGroupInput aria-label="API key" defaultValue="sk-test" />
        <InputGroupAddon align="inline-end">
          <Button size="small" variant="tertiary" onClick={onCopy}>
            Copy
          </Button>
        </InputGroupAddon>
      </InputGroup>,
    )

    const input = screen.getByRole('textbox', { name: 'API key' })
    const copyButton = screen.getByRole('button', { name: 'Copy' })
    const group = screen.getByTestId('group')
    const restingBoxShadow = getComputedStyle(group.element()).boxShadow

    await input.click()
    await expect.poll(() => getComputedStyle(group.element()).boxShadow).not.toBe(restingBoxShadow)

    await copyButton.click()

    await expect.element(copyButton).toHaveFocus()
    await expect.poll(() => getComputedStyle(group.element()).boxShadow).toBe(restingBoxShadow)
    expect(onCopy).toHaveBeenCalledTimes(1)
  })
})
