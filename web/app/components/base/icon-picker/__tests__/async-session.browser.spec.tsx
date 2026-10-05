import type { PostFilesUploadResponse } from '@dify/contracts/api/console/files/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconPickerDialog } from '..'
import { emojiCatalogOptions } from '../emoji-data'

const { cropImage, uploadImage } = vi.hoisted(() => ({
  cropImage: vi.fn<() => Promise<Blob>>(),
  uploadImage: vi.fn<() => Promise<PostFilesUploadResponse>>(),
}))

vi.mock('../image-crop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../image-crop')>()),
  default: cropImage,
}))
vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: uploadImage }) } } },
  },
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

async function createImageFile() {
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 100
  canvas.getContext('2d')!.fillRect(0, 0, 100, 100)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), 'image/png'),
  )
  return new File([blob], 'icon.png', { type: 'image/png' })
}

async function openImageSession() {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const onConfirm = vi.fn()
  const screen = await render(
    <QueryClientProvider client={client}>
      <IconPickerDialog
        aria-label="Choose icon"
        value={{ type: 'emoji', icon: '😀', background: '#FEF3F2' }}
        onConfirm={onConfirm}
      />
    </QueryClientProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'Choose icon' })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await dialog.getByRole('tab', { name: 'app.iconPicker.image' }).click()
  const file = await createImageFile()
  await dialog.getByTestId('image-input').upload(file)
  await expect.element(dialog.getByRole('group', { name: 'app.iconPicker.crop' })).toBeVisible()
  const save = dialog.getByRole('button', { name: 'app.iconPicker.ok' })
  await expect.element(save).toBeEnabled()
  return { screen, client, trigger, dialog, save, file, onConfirm }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('ignores crop completion during the closing animation while Cancel remains available', async () => {
  let finishCrop!: (blob: Blob) => void
  cropImage.mockReturnValueOnce(
    new Promise<Blob>((resolve) => {
      finishCrop = resolve
    }),
  )
  const { client, trigger, dialog, save, file, onConfirm } = await openImageSession()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  await save.click()
  await expect.poll(() => cropImage.mock.calls.length).toBe(1)
  const cancel = dialog.getByRole('button', { name: 'app.iconPicker.cancel' })
  await expect.element(cancel).toBeEnabled()
  const exitFrame = new Promise<number>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      finishCrop(file)
      resolve(Number(getComputedStyle(popup).opacity))
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await cancel.click()
  expect(await exitFrame).toBeGreaterThan(0)
  await expect.element(dialog).not.toBeInTheDocument()
  expect(uploadImage).not.toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(dialog.getByRole('combobox', { name: 'app.iconPicker.search' }))
    .toHaveFocus()
  await expect
    .element(dialog.getByRole('radio', { name: 'app.iconPicker.color.red' }))
    .toBeChecked()
  client.clear()
})

it('ignores a preview read that completes after cancellation and a new session opens', async () => {
  const { client, trigger, dialog, save, file, onConfirm } = await openImageSession()
  cropImage.mockResolvedValueOnce(file)
  const originalRead = FileReader.prototype.readAsDataURL
  let finishRead!: () => Promise<void>
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementationOnce(function (
    this: FileReader,
    blob: Blob,
  ) {
    finishRead = () =>
      new Promise<void>((resolve) => {
        this.addEventListener('loadend', () => resolve(), { once: true })
        originalRead.call(this, blob)
      })
  })
  await save.click()
  await expect.poll(() => read.mock.calls.length).toBe(1)
  await dialog.getByRole('button', { name: 'app.iconPicker.cancel' }).click()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const search = dialog.getByRole('combobox', { name: 'app.iconPicker.search' })
  await expect.element(search).toHaveFocus()
  await search.fill('new session')
  await finishRead()
  await userEvent.keyboard('{End}')
  expect(uploadImage).not.toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
  await expect.element(dialog).toBeVisible()
  await expect.element(search).toHaveValue('new session')
  client.clear()
})

it('ignores an old upload when reopened as soon as keyboard focus returns', async () => {
  let finishUpload!: (response: PostFilesUploadResponse) => void
  const pendingUpload = new Promise<PostFilesUploadResponse>((resolve) => {
    finishUpload = resolve
  })
  uploadImage.mockReturnValueOnce(pendingUpload)
  const { client, trigger, dialog, save, file, onConfirm } = await openImageSession()
  cropImage.mockResolvedValueOnce(file)
  await save.click()
  await expect.poll(() => uploadImage.mock.calls.length).toBe(1)
  await expect.element(dialog.getByRole('button', { name: 'app.iconPicker.cancel' })).toBeEnabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const search = dialog.getByRole('combobox', { name: 'app.iconPicker.search' })
  await expect.element(search).toHaveFocus()
  await dialog.getByRole('radio', { name: 'app.iconPicker.color.green' }).click()
  finishUpload({ id: 'old-upload', name: 'icon.png', size: file.size })
  await pendingUpload
  await search.fill('new session')
  expect(onConfirm).not.toHaveBeenCalled()
  expect(uploadImage).toHaveBeenCalledTimes(1)
  await expect.element(dialog).toBeVisible()
  await expect.element(search).toHaveValue('new session')
  await expect
    .element(dialog.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    .toBeChecked()
  client.clear()
})
