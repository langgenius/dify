import type {
  PostFilesUploadData,
  PostFilesUploadResponse,
} from '@dify/contracts/api/console/files/types.gen'
import type { IconPickerDefaultValue } from '..'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconPickerDialog } from '..'
import { emojiCatalogOptions } from '../emoji-data'

const { uploadImage } = vi.hoisted(() => ({
  uploadImage:
    vi.fn<(input: Pick<PostFilesUploadData, 'body'>) => Promise<PostFilesUploadResponse>>(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: uploadImage }) } } },
  },
}))

beforeEach(() => {
  uploadImage.mockReset()
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
  uploadImage.mockRejectedValueOnce(new Error('Upload failed'))
  uploadImage.mockResolvedValueOnce({ id: 'uploaded-image', name: 'icon.gif', size: 6 })
  const { user, client, file, confirm, onConfirm, onOpenChange } = await selectImage()
  await user.click(confirm)
  await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce())
  expect(uploadImage.mock.calls[0]![0].body.file).toBe(file)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'common.imageUploader.uploadFromComputerUploadError',
  )
  await user.click(confirm)
  await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
    type: 'image',
    fileId: 'uploaded-image',
    url: expect.stringContaining('data:image/gif;base64,'),
  })
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  client.clear()
})

it('does not confirm an upload that finishes after the picker is unmounted', async () => {
  let finishUpload!: (response: PostFilesUploadResponse) => void
  uploadImage.mockReturnValueOnce(
    new Promise((resolve) => {
      finishUpload = resolve
    }),
  )
  const { user, client, confirm, onConfirm, onOpenChange, unmount } = await selectImage()
  await user.click(confirm)
  await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce())
  unmount()
  await act(async () => {
    finishUpload({ id: 'late-image', name: 'icon.gif', size: 6 })
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
  expect(uploadImage).not.toHaveBeenCalled()
  client.clear()
})

it('allows retry after reading the image preview fails', async () => {
  const { user, client, confirm, onConfirm } = await selectImage()
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementationOnce(function (
    this: FileReader,
  ) {
    this.dispatchEvent(new Event('error'))
  })
  await user.click(confirm)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'common.imageUploader.uploadFromComputerReadError',
  )
  expect(confirm).toBeEnabled()
  expect(uploadImage).not.toHaveBeenCalled()
  read.mockRestore()
  uploadImage.mockResolvedValueOnce({ id: 'retried-image', name: 'icon.gif', size: 6 })
  await user.click(confirm)
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  client.clear()
})

it.each([undefined, null])(
  'resolves a missing emoji background only when confirmed (%s)',
  async (background) => {
    const user = userEvent.setup()
    const client = new QueryClient()
    client.setQueryData(emojiCatalogOptions.queryKey, [])
    const onConfirm = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <IconPickerDialog
          open
          defaultValue={{ type: 'emoji', icon: '😀', background }}
          onConfirm={onConfirm}
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    )
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      type: 'emoji',
      icon: '😀',
      background: '#FEF3F2',
    })
    client.clear()
  },
)

it('keeps open-session edits and reads the latest default when reopened', async () => {
  const user = userEvent.setup()
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const picker = (open: boolean, defaultValue: IconPickerDefaultValue) => (
    <QueryClientProvider client={client}>
      <IconPickerDialog
        open={open}
        defaultValue={defaultValue}
        onConfirm={onConfirm}
        onOpenChange={() => {}}
      />
    </QueryClientProvider>
  )
  const view = render(picker(true, { type: 'emoji', icon: '😀', background: '#FEF3F2' }))
  await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
  const nextDefault = { type: 'image' as const, fileId: 'new-image', url: '/new-image.png' }
  view.rerender(picker(true, nextDefault))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenLastCalledWith({ type: 'emoji', icon: '😀', background: '#F3FEE7' })
  view.rerender(picker(false, nextDefault))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(picker(true, nextDefault))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenLastCalledWith(nextDefault)
  expect(uploadImage).not.toHaveBeenCalled()
  client.clear()
})
