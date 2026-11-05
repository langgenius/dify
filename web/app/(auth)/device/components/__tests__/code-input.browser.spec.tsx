import { render } from 'vitest-browser-react'
import CodeInput from '../code-input'

it('puts the cursor in the device code field on arrival', async () => {
  const screen = await render(<CodeInput value="" onChange={() => {}} />)

  await expect.element(screen.getByRole('textbox')).toHaveFocus()
})
