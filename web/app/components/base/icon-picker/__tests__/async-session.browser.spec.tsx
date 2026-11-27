import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emulateReducedMotion } from '@/test/browser-media-emulation'
import { hold, route, setupFakeApi } from '@/test/fake-api'
import { basePath } from '@/utils/var'
import { emojiCatalogOptions } from '../emoji-data'
import { IconPickerDialog } from './harness'

// The contract requires UUID file ids; derive a stable one from each readable key.
const fileId = (key: string) =>
  `00000000-0000-4000-8000-${Array.from(key, (char) => char.charCodeAt(0).toString(16))
    .join('')
    .slice(0, 12)
    .padStart(12, '0')}`

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

// Reopening the picker refetches the static emojibase catalog from the app origin.
const emojiCatalog = `${basePath}/emoji/emojibase-17.0.0/en`
const fake = setupFakeApi(() => ({
  routes: [
    route('GET', 'origin', `${emojiCatalog}/data.json`, () => []),
    route('GET', 'origin', `${emojiCatalog}/messages.json`, () => ({
      groups: [],
      subgroups: [],
      skinTones: [],
    })),
  ],
  console: {
    files: {
      upload: {
        post: ({ body }) => ({
          id: fileId('uploaded'),
          name: 'uploaded-image',
          size: body.file.size,
        }),
      },
    },
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('ignores crop completion during the closing animation while Cancel remains available', async () => {
  // The closing animation is the window this race needs.
  await emulateReducedMotion(false)
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
  expect(fake.console.files.upload.post).not.toHaveBeenCalled()
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
  const upload = hold(fake.console.files.upload.post)
  const { client, trigger, dialog, save, file, onConfirm } = await openImageSession()
  await save.click()
  // Cropping and encoding take a while on a slow runner; wait for the request itself.
  const uploadedFile = (await upload.arrived).body.file
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
  upload.resolve({ id: fileId('old-upload'), name: 'icon.png', size: file.size })
  await search.fill('new session')
  expect(onConfirm).not.toHaveBeenCalled()
  expect(fake.console.files.upload.post).toHaveBeenCalledTimes(1)
  await expect.element(dialog).toBeVisible()
  await expect.element(search).toHaveValue('new session')
  await expect
    .element(dialog.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    .toBeChecked()
  client.clear()
})
