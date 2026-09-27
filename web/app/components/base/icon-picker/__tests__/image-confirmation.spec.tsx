import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconPickerDialog } from '..'
import { imageUpload } from '../../image-uploader/utils'
import { emojiCatalogOptions } from '../emoji-data'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('../../image-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../image-uploader/utils')>()),
  imageUpload: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

async function selectImage() {
  const user = userEvent.setup()
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <IconPickerDialog open onConfirm={onConfirm} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('tab', { name: 'app.iconPicker.image' }))
  const file = new File(['GIF89a'], 'icon.gif', { type: 'image/gif' })
  fireEvent.change(screen.getByTestId('image-input'), { target: { files: [file] } })
  const confirm = await screen.findByRole('button', { name: 'app.iconPicker.ok' })
  return { ...view, user, client, file, confirm, onConfirm, onOpenChange }
}

it('keeps the image draft after an upload failure and confirms the retried upload', async () => {
  const { user, client, file, confirm, onConfirm, onOpenChange } = await selectImage()
  await user.click(confirm)
  await waitFor(() => expect(imageUpload).toHaveBeenCalledOnce())
  expect(vi.mocked(imageUpload).mock.calls[0]![0].file).toBe(file)
  expect(onConfirm).not.toHaveBeenCalled()
  await act(async () => vi.mocked(imageUpload).mock.calls[0]![0].onErrorCallback?.())
  await user.click(confirm)
  await waitFor(() => expect(imageUpload).toHaveBeenCalledTimes(2))
  await act(async () => {
    vi.mocked(imageUpload).mock.calls[1]![0].onSuccessCallback?.({ id: 'uploaded-image' })
  })
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
    type: 'image',
    fileId: 'uploaded-image',
    url: expect.stringContaining('data:image/gif;base64,'),
  })
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  client.clear()
})

it('does not confirm an upload that finishes after the picker is unmounted', async () => {
  const { user, client, confirm, onConfirm, onOpenChange, unmount } = await selectImage()
  await user.click(confirm)
  await waitFor(() => expect(imageUpload).toHaveBeenCalledOnce())
  unmount()
  await act(async () => {
    vi.mocked(imageUpload).mock.calls[0]![0].onSuccessCallback?.({ id: 'late-image' })
  })
  expect(onConfirm).not.toHaveBeenCalled()
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  client.clear()
})

it('confirms an existing image without uploading it again', async () => {
  const user = userEvent.setup()
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const value = { type: 'image' as const, fileId: 'existing', url: '/existing.png' }
  render(
    <QueryClientProvider client={client}>
      <IconPickerDialog open defaultValue={value} onConfirm={onConfirm} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(value)
  expect(imageUpload).not.toHaveBeenCalled()
  client.clear()
})
