import { useState } from 'react'
import { render } from 'vitest-browser-react'
import ParagraphInput from '../paragraph-input'

function Editor() {
  const [value, setValue] = useState('one\ntwo\nthree\nfour')
  return <ParagraphInput value={value} onChange={setValue} />
}

it('keeps multiline content readable and reduces the gutter after editing down to one line', async () => {
  const screen = await render(<Editor />)
  const input = screen.getByRole('textbox')
  await expect.element(input).toHaveValue('one\ntwo\nthree\nfour')
  const fourthLine = screen.getByText('04')
  await expect.element(fourthLine).toBeVisible()
  // Real geometry proves the fourth text line fits in the editor instead of merely counting labels.
  const bounds = input.element().getBoundingClientRect()
  const line = fourthLine.element().getBoundingClientRect()
  expect(line.top).toBeGreaterThanOrEqual(bounds.top)
  expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)

  await input.fill('one')
  await expect.element(input).toHaveValue('one')
  await expect.element(screen.getByText('03')).toBeVisible()
  await expect.element(fourthLine).not.toBeInTheDocument()
})
