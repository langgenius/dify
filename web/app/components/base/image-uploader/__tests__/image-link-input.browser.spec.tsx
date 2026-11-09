import type { ImageFile } from '@/types/app'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TransferMethod } from '@/types/app'
import ImageLinkInput from '../image-link-input'

function LinkExample({ disabled = false }: { disabled?: boolean }) {
  const [file, setFile] = useState<ImageFile>()
  return (
    <>
      <ImageLinkInput disabled={disabled} onUpload={setFile} />
      <output aria-label="Submitted image">{file && JSON.stringify(file)}</output>
    </>
  )
}

it.each([
  ['https://example.com/image.png', 0],
  ['http://example.com/image.png', 0],
  ['ftp://files.example.com/image.png', 0],
  ['not-a-valid-url', -1],
  ['example.com/image.png', -1],
])('submits %s with its upload eligibility', async (url, progress) => {
  await page.viewport(640, 480)
  const screen = await render(<LinkExample />)
  const submit = screen.getByRole('button', { name: 'common.operation.ok' })
  await expect.element(submit).toBeDisabled()
  await screen.getByRole('textbox').fill(url)
  await submit.click()
  await expect
    .element(screen.getByRole('status', { name: 'Submitted image' }))
    .not.toBeEmptyDOMElement()
  const result = JSON.parse(
    screen.getByRole('status', { name: 'Submitted image' }).element().textContent!,
  )
  expect(result).toEqual({
    _id: expect.any(String),
    type: TransferMethod.remote_url,
    url,
    progress,
    fileId: '',
  })
})

it('keeps the entered URL through a disabled transition and disables submission after clearing', async () => {
  await page.viewport(640, 480)
  const screen = await render(<LinkExample disabled />)
  const input = screen.getByRole('textbox')
  const submit = screen.getByRole('button', { name: 'common.operation.ok' })
  await input.fill('https://example.com/image.png')
  await expect.element(submit).toBeDisabled()
  await expect.element(screen.getByRole('status')).toBeEmptyDOMElement()
  await screen.rerender(<LinkExample />)
  await submit.click()
  await expect
    .poll(() => JSON.parse(screen.getByRole('status').element().textContent!).url)
    .toBe('https://example.com/image.png')
  await input.fill('')
  await expect.element(submit).toBeDisabled()
})
