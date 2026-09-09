import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Button } from '../../button'
import { Field, FieldLabel } from '../../field'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../popover'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../index'

function InputGroupInputTypeExamples() {
  // @ts-expect-error InputGroupInput requires a native input host
  return <InputGroupInput render={<textarea />} />
}

void InputGroupInputTypeExamples

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

  it('should extend the input pointer surface through a static add-on', async () => {
    const screen = await render(
      <InputGroup>
        <InputGroupInput aria-label="Repository URL" />
        <InputGroupAddon>https://</InputGroupAddon>
      </InputGroup>,
    )

    await screen.getByText('https://').click()

    await expect.element(screen.getByRole('textbox', { name: 'Repository URL' })).toHaveFocus()
  })

  it('should let consumers cancel input pointer-surface behavior', async () => {
    const screen = await render(
      <InputGroup onMouseDown={(event) => event.preventDefault()}>
        <InputGroupInput aria-label="Repository URL" />
        <InputGroupAddon>https://</InputGroupAddon>
      </InputGroup>,
    )

    await screen.getByText('https://').click()

    await expect.element(screen.getByRole('textbox', { name: 'Repository URL' })).not.toHaveFocus()
  })

  it('should show keyboard focus on a read-only input', async () => {
    const screen = await render(
      <InputGroup data-testid="group">
        <InputGroupInput aria-label="API key" defaultValue="sk-test" readOnly />
      </InputGroup>,
    )
    const group = screen.getByTestId('group')
    const input = screen.getByRole('textbox', { name: 'API key' })
    const restingBoxShadow = getComputedStyle(group.element()).boxShadow

    await userEvent.keyboard('{Tab}')

    await expect.element(input).toHaveFocus()
    await expect.poll(() => getComputedStyle(group.element()).boxShadow).not.toBe(restingBoxShadow)
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

  it('should not handle pointer events from portalled add-on content', async () => {
    const screen = await render(
      <InputGroup>
        <InputGroupInput aria-label="File name" />
        <InputGroupAddon align="inline-end">
          <Popover>
            <PopoverTrigger>More</PopoverTrigger>
            <PopoverContent>
              <PopoverTitle className="sr-only">File actions</PopoverTitle>
              <span>File details</span>
            </PopoverContent>
          </Popover>
        </InputGroupAddon>
      </InputGroup>,
    )

    await screen.getByRole('button', { name: 'More' }).click()
    const popup = screen.getByRole('dialog', { name: 'File actions' })
    await expect.element(popup).toHaveFocus()

    await screen.getByText('File details').click()

    await expect.element(popup).toHaveFocus()
    await expect.element(screen.getByRole('textbox', { name: 'File name' })).not.toHaveFocus()
  })

  it('should keep a visually leading interactive add-on after the input in focus order', async () => {
    const screen = await render(
      <InputGroup>
        <InputGroupInput aria-label="Amount" />
        <InputGroupAddon>
          <Button size="small" variant="tertiary">
            Currency
          </Button>
        </InputGroupAddon>
      </InputGroup>,
    )

    const input = screen.getByRole('textbox', { name: 'Amount' })
    const addonButton = screen.getByRole('button', { name: 'Currency' })
    input.element().focus()

    await userEvent.keyboard('{Tab}')

    await expect.element(addonButton).toHaveFocus()
  })
})
