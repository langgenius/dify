import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import AutoHeightTextarea from '../index'

function Editor() {
  const [value, setValue] = useState('hello')
  const [controlFocus, setControlFocus] = useState(1)
  return (
    <>
      <AutoHeightTextarea
        aria-label="Message"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        controlFocus={controlFocus}
      />
      <button
        onClick={() => {
          setValue('hello world')
          setControlFocus(2)
        }}
      >
        Replace message
      </button>
    </>
  )
}

it('focuses the replacement text at its end when the caller requests focus', async () => {
  await page.viewport(800, 600)
  await render(<Editor />)
  const input = page.getByRole('textbox', { name: 'Message' })
  await expect.element(input).toHaveFocus()
  await userEvent.keyboard('!')
  await expect.element(input).toHaveValue('hello!')
  await page.getByRole('button', { name: 'Replace message' }).click()
  await expect.element(input).toHaveFocus()
  await userEvent.keyboard('!')
  await expect.element(input).toHaveValue('hello world!')
})
