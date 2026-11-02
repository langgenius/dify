import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import ImageLinkInput from '../image-link-input'

it.each([
  ['https://example.com/image.png', 0],
  ['http://example.com/image.png', 0],
  ['ftp://files.example.com/image.png', 0],
  ['not-a-valid-url', -1],
  ['example.com/image.png', -1],
])('submits %s with upload status %s', async (url, progress) => {
  const user = userEvent.setup()
  const onUpload = vi.fn()
  render(<ImageLinkInput onUpload={onUpload} />)
  expect(screen.getByRole('button', { name: 'common.operation.ok' })).toBeDisabled()
  await user.type(screen.getByRole('textbox'), url)
  await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
  expect(onUpload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: TransferMethod.remote_url,
      url,
      progress,
      fileId: '',
    }),
  )
})

it('prevents submission while disabled and allows the entered URL after re-enabling', async () => {
  const user = userEvent.setup()
  const onUpload = vi.fn()
  const { rerender } = render(<ImageLinkInput onUpload={onUpload} disabled />)
  await user.type(screen.getByRole('textbox'), 'https://example.com/image.png')
  await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
  expect(onUpload).not.toHaveBeenCalled()
  rerender(<ImageLinkInput onUpload={onUpload} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
  expect(onUpload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ url: 'https://example.com/image.png', progress: 0 }),
  )
  await user.clear(screen.getByRole('textbox'))
  expect(screen.getByRole('button', { name: 'common.operation.ok' })).toBeDisabled()
})
