import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import Input from '../base/text-input'

function NumericInputOwner() {
  const [value, setValue] = useState<string | number>(7)

  return (
    <>
      <Input isNumber value={value} onChange={setValue} />
      <output aria-label="Saved page limit">{value}</output>
    </>
  )
}

it('keeps the native numeric field and its saved integer value in sync', async () => {
  await render(<NumericInputOwner />)
  const input = page.getByRole('spinbutton')
  const saved = page.getByRole('status', { name: 'Saved page limit' })

  await expect.element(input).toHaveAttribute('min', '0')
  await input.fill('42')
  await expect.element(input).toHaveValue(42)
  await expect.element(saved).toHaveTextContent('42')

  await input.fill('')
  await expect.element(input).toHaveValue(null)
  await expect.element(saved).toBeEmptyDOMElement()

  await input.fill('-5')
  await expect.element(input).toHaveValue(0)
  await expect.element(saved).toHaveTextContent('0')
  expect((input.element() as HTMLInputElement).validity.rangeUnderflow).toBe(false)

  await input.fill('3.7')
  await expect.element(input).toHaveValue(3)
  await expect.element(saved).toHaveTextContent('3')
})
