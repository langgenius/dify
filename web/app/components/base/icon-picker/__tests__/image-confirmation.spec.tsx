import type {
  PostFilesUploadData,
  PostFilesUploadResponse,
} from '@dify/contracts/api/console/files/types.gen'
import type { IconPickerInputValue } from '..'
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

async function selectImage(defaultValue?: IconPickerInputValue) {
  const user = userEvent.setup()
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <IconPickerDialog value={defaultValue} onConfirm={onConfirm} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
  onOpenChange.mockClear()
  await user.click(screen.getByRole('tab', { name: 'app.iconPicker.image' }))
  if (defaultValue?.type === 'image')
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))
  const file = new File(['GIF89a'], 'icon.gif', { type: 'image/gif' })
  await user.upload(screen.getByTestId('image-input'), file)
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
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  client.clear()
})

it('opens the file input directly and preserves the existing image on cancellation or invalid selection', async () => {
  const user = userEvent.setup({ applyAccept: false })
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const value = { type: 'image' as const, fileId: 'existing', url: '/existing.png' }
  render(
    <QueryClientProvider client={client}>
      <IconPickerDialog value={value} onConfirm={onConfirm} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
  const input = screen.getByTestId('image-input')
  const openFilePicker = vi.spyOn(input, 'click')
  await user.click(screen.getByRole('button', { name: 'common.operation.change' }))
  expect(openFilePicker).toHaveBeenCalledOnce()
  fireEvent(input, new Event('cancel', { bubbles: true }))
  expect(screen.getByRole('img', { name: 'app.iconPicker.image' })).toHaveAttribute(
    'src',
    value.url,
  )
  expect(screen.queryByRole('button', { name: 'common.imageInput.browse' })).not.toBeInTheDocument()
  expect(onConfirm).not.toHaveBeenCalled()
  await user.upload(input, new File(['text'], 'invalid.txt', { type: 'text/plain' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('common.imageInput.supportedFormats')
  expect(screen.getByRole('img', { name: 'app.iconPicker.image' })).toHaveAttribute(
    'src',
    value.url,
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
          value={{ type: 'emoji', icon: '😀', background }}
          onConfirm={onConfirm}
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
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
  const picker = (value: IconPickerInputValue) => (
    <QueryClientProvider client={client}>
      <IconPickerDialog value={value} onConfirm={onConfirm} onOpenChange={() => {}} />
    </QueryClientProvider>
  )
  const view = render(picker({ type: 'emoji', icon: '😀', background: '#FEF3F2' }))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
  await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
  const nextDefault = { type: 'image' as const, fileId: 'new-image', url: '/new-image.png' }
  view.rerender(picker(nextDefault))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenLastCalledWith({ type: 'emoji', icon: '😀', background: '#F3FEE7' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenLastCalledWith(nextDefault)
  expect(uploadImage).not.toHaveBeenCalled()
  client.clear()
})

it.each(['upload', 'preview'])(
  'clears a %s error when replacing the image and uploads the replacement',
  async (failure) => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    if (failure === 'upload') uploadImage.mockRejectedValueOnce(new Error('Upload failed'))
    else
      read.mockImplementationOnce(function (this: FileReader) {
        this.dispatchEvent(new Event('error'))
      })
    const { user, client, confirm, onConfirm } = await selectImage()
    await user.click(confirm)
    await screen.findByRole('alert')
    read.mockRestore()
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))
    const replacement = new File(['GIF89a-replacement'], 'replacement.gif', { type: 'image/gif' })
    await user.upload(screen.getByTestId('image-input'), replacement)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    uploadImage.mockResolvedValueOnce({
      id: 'replacement',
      name: 'replacement.gif',
      size: replacement.size,
    })
    await user.click(await screen.findByRole('button', { name: 'app.iconPicker.ok' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(uploadImage.mock.lastCall![0].body.file).toBe(replacement)
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'replacement' }))
    client.clear()
  },
)

it('blocks replacement by browsing or dropping while uploading and restores editing on failure', async () => {
  let rejectUpload!: (reason: Error) => void
  uploadImage.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectUpload = reject
    }),
  )
  const { user, client, confirm, file, onConfirm } = await selectImage()
  await user.click(confirm)
  await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce())
  const change = screen.getByRole('button', { name: 'common.operation.change' })
  const input = screen.getByTestId('image-input')
  expect(change).toBeDisabled()
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: 'app.iconPicker.cancel' })).toBeEnabled()
  const replacement = new File(['GIF89a-replacement'], 'replacement.gif', { type: 'image/gif' })
  await user.click(change)
  await user.upload(input, replacement)
  fireEvent.drop(screen.getByRole('img', { name: 'app.iconPicker.image' }), {
    dataTransfer: { types: ['Files'], files: [replacement] },
  })
  await act(async () => {
    rejectUpload(new Error('Upload failed'))
  })
  await screen.findByRole('alert')
  expect(change).toBeEnabled()
  expect(input).toBeEnabled()
  uploadImage.mockResolvedValueOnce({ id: 'original', name: file.name, size: file.size })
  await user.click(confirm)
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  expect(uploadImage.mock.calls[1]![0].body.file).toBe(file)
  client.clear()
})

it('replaces an existing image only after selecting a file and confirms the new upload', async () => {
  const previous = { type: 'image' as const, fileId: 'existing', url: '/existing.png' }
  uploadImage.mockResolvedValueOnce({ id: 'replacement', name: 'icon.gif', size: 6 })
  const { user, client, file, confirm, onConfirm } = await selectImage(previous)
  expect(screen.getByRole('img', { name: 'app.iconPicker.image' })).not.toHaveAttribute(
    'src',
    previous.url,
  )
  expect(onConfirm).not.toHaveBeenCalled()
  await user.click(confirm)
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  expect(uploadImage.mock.calls[0]![0].body.file).toBe(file)
  expect(onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'image', fileId: 'replacement' }),
  )
  client.clear()
})

it('preserves a linked icon on cancellation and only replaces it after confirmation', async () => {
  const user = userEvent.setup()
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const value = { type: 'link' as const, url: '/linked-icon.png' }
  render(
    <QueryClientProvider client={client}>
      <IconPickerDialog value={value} onConfirm={onConfirm} />
    </QueryClientProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'app.iconPicker.title' })
  expect(trigger.querySelector('img')).toHaveAttribute('src', value.url)
  await user.click(trigger)
  expect(screen.getByRole('tab', { name: 'app.iconPicker.emoji' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onConfirm).not.toHaveBeenCalled()
  expect(trigger.querySelector('img')).toHaveAttribute('src', value.url)
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }))
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'emoji' }))
  expect(uploadImage).not.toHaveBeenCalled()
  client.clear()
})

it('keeps an unavailable icon entry disabled', async () => {
  const user = userEvent.setup()
  render(<IconPickerDialog disabled onConfirm={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'app.iconPicker.title' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps emoji-only consumers out of image upload', async () => {
  const user = userEvent.setup()
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <IconPickerDialog
        enableImageUpload={false}
        value={{ type: 'emoji', icon: '😀', background: '#FEF3F2' }}
        onConfirm={onConfirm}
      />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
  expect(screen.queryByRole('tab', { name: 'app.iconPicker.image' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('image-input')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'emoji' }))
  expect(uploadImage).not.toHaveBeenCalled()
  client.clear()
})
