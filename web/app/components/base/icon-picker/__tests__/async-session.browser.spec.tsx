import type { PostFilesUploadResponse } from '@dify/contracts/api/console/files/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emojiCatalogOptions } from '../emoji-data'
import { IconPickerDialog } from './harness'

const { uploadImage } = vi.hoisted(() => ({
  uploadImage: vi.fn<(request: { body: { file: File } }) => Promise<PostFilesUploadResponse>>(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: uploadImage }) } } },
  },
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

async function createImageFile() {
  const canvas = document.createElement('canvas')
  canvas.width = 120
  canvas.height = 80
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ef4444'
  context.fillRect(0, 0, 60, 80)
  context.fillStyle = '#3b82f6'
  context.fillRect(60, 0, 60, 80)
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

function deferNextCanvasBlob() {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob
  let release!: () => void
  let encodedBlob!: Blob
  const encoded = new Promise<void>((resolve) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      type,
      quality,
    ) {
      originalToBlob.call(
        this,
        (blob) => {
          if (!blob) {
            callback(null)
            resolve()
            return
          }
          encodedBlob = blob
          release = () => callback(blob)
          resolve()
        },
        type,
        quality,
      )
    })
  })
  return {
    encoded,
    getBlob: () => encodedBlob,
    release: () => release(),
  }
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
  const { client, trigger, dialog, save, onConfirm } = await openImageSession()
  const crop = deferNextCanvasBlob()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  await save.click()
  await crop.encoded
  const bitmap = await createImageBitmap(crop.getBlob())
  expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 80, height: 80 })
  bitmap.close()
  const cancel = dialog.getByRole('button', { name: 'app.iconPicker.cancel' })
  await expect.element(cancel).toBeEnabled()
  const exitFrame = new Promise<number>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      crop.release()
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

it('ignores an old upload when reopened as soon as keyboard focus returns', async () => {
  let finishUpload!: (response: PostFilesUploadResponse) => void
  const pendingUpload = new Promise<PostFilesUploadResponse>((resolve) => {
    finishUpload = resolve
  })
  uploadImage.mockReturnValueOnce(pendingUpload)
  const { client, trigger, dialog, save, file, onConfirm } = await openImageSession()
  await save.click()
  await expect.poll(() => uploadImage.mock.calls.length).toBe(1)
  const uploadedFile = uploadImage.mock.calls[0]![0].body.file
  const bitmap = await createImageBitmap(uploadedFile)
  expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 80, height: 80 })
  bitmap.close()
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
