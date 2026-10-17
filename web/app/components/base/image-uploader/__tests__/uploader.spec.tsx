import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// oxlint-disable-next-line no-restricted-imports -- Isolate the existing upload transport used by the uploader under test.
import { upload } from '@/service/base'
import { TransferMethod } from '@/types/app'
import Uploader from '../uploader'

vi.mock('@/next/navigation', () => ({ useParams: () => ({ token: 'shared-app' }) }))
vi.mock('@/service/base', () => ({ upload: vi.fn() }))

beforeEach(() => {
  vi.mocked(upload).mockResolvedValue({ id: 'uploaded-image' })
})

it('uploads a selected image through the real hook and permits selecting the same file again', async () => {
  const user = userEvent.setup()
  const onUpload = vi.fn()
  const closePopover = vi.fn()
  render(
    <Uploader onUpload={onUpload} closePopover={closePopover} limit={3}>
      {() => <span>Upload image</span>}
    </Uploader>,
  )
  const input = screen.getByTestId('local-file-input') as HTMLInputElement
  const file = new File(['image'], 'demo.png', { type: 'image/png' })

  await user.upload(input, file)
  await waitFor(() =>
    expect(onUpload).toHaveBeenLastCalledWith(
      expect.objectContaining({
        file,
        fileId: 'uploaded-image',
        type: TransferMethod.local_file,
        progress: 100,
      }),
    ),
  )
  expect(closePopover).toHaveBeenCalledTimes(1)
  expect(upload).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.any(FormData) }),
    true,
    undefined,
  )

  await user.upload(input, file)
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(4))
  expect(closePopover).toHaveBeenCalledTimes(2)
})

it('blocks file selection when disabled', async () => {
  const user = userEvent.setup()
  const onUpload = vi.fn()
  const closePopover = vi.fn()
  render(
    <Uploader disabled onUpload={onUpload} closePopover={closePopover}>
      {() => <span>Upload image</span>}
    </Uploader>,
  )
  const input = screen.getByTestId('local-file-input') as HTMLInputElement
  expect(input).toBeDisabled()
  await user.upload(input, new File(['image'], 'demo.png', { type: 'image/png' }))
  expect(upload).not.toHaveBeenCalled()
  expect(onUpload).not.toHaveBeenCalled()
  expect(closePopover).not.toHaveBeenCalled()
})
