import type {
  PostFilesUploadData,
  PostFilesUploadResponse,
} from '@dify/contracts/api/console/files/types.gen'
import type { IconPickerInputValue, IconPickerValue } from '..'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { dropFixtureFile } from '@/test/browser-file-drag'
import { createDeferred } from '@/test/deferred'
import { createGifFile } from '@/test/fixtures/image-files'
import gifDataUrl from '@/test/fixtures/media/preview.gif?url&inline'
import { guardPreviewFetch } from '@/test/fixtures/preview-files'
import { createIconPickerEnvironment, defaultIcon } from '@/test/icon-picker'
import { IconPicker, IconPickerContent, IconPickerIcon, IconPickerTrigger } from '..'
import { IconPickerCaller } from './icon-picker-caller'

const { uploadImage } = vi.hoisted(() => ({
  uploadImage:
    vi.fn<(input: Pick<PostFilesUploadData, 'body'>) => Promise<PostFilesUploadResponse>>(),
}))
// boundary: console file upload is the external persistence service for the rendered picker.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'files.upload.post': uploadImage }),
  }
})
// boundary: isolated picker rendering has no Next route, while upload only requires empty params.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

let restoreFetch: () => void
beforeEach(() => {
  // boundary: preview transport rejects backend requests while native local URLs stay real.
  restoreFetch = guardPreviewFetch()
  uploadImage.mockReset()
})
afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

const dialog = () => page.getByRole('dialog', { name: 'app.iconPicker.title' })
const save = () => dialog().getByRole('button', { name: 'app.iconPicker.ok' })
const saved = () => page.getByLabelText('Saved icon')

async function setup(initialValue: IconPickerInputValue = defaultIcon, enableImageUpload = true) {
  const { Wrapper } = createIconPickerEnvironment()
  await render(
    <Wrapper>
      <IconPickerCaller initialValue={initialValue} enableImageUpload={enableImageUpload} />
    </Wrapper>,
  )
  await page.getByRole('button', { name: 'Choose icon' }).click()
}

async function selectImage(initialValue?: IconPickerInputValue) {
  await setup(initialValue)
  await page.getByRole('tab', { name: 'app.iconPicker.image' }).click()
  if (initialValue?.type === 'image')
    await page.getByRole('button', { name: 'common.operation.change' }).click()
  const file = createGifFile()
  await page.getByTestId('image-input').upload(file)
  const image = dialog().getByRole('img', { name: 'app.iconPicker.image' })
  await expect.element(image).toBeVisible()
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(1)
  await expect.element(save()).toBeEnabled()
  return file
}

async function expectSavedImage(id: string, file: File) {
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(saved()).toMatchTextContent(id)
  const image = page.getByRole('img', { name: 'Saved icon preview' })
  await expect.element(image).toBeVisible()
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(1)
  const preview = await (await fetch((image.element() as HTMLImageElement).src)).blob()
  expect(new Uint8Array(await preview.arrayBuffer())).toEqual(
    new Uint8Array(await file.arrayBuffer()),
  )
  expect(new Uint8Array(await uploadImage.mock.lastCall![0].body.file.arrayBuffer())).toEqual(
    new Uint8Array(await file.arrayBuffer()),
  )
  await expect.element(page.getByRole('button', { name: 'Choose icon' })).toHaveFocus()
}

it('keeps the image draft after an upload failure and saves the retried bytes', async () => {
  await page.viewport(640, 600)
  uploadImage.mockRejectedValueOnce(new Error('Upload failed'))
  uploadImage.mockResolvedValueOnce({
    id: 'retried-image',
    name: 'icon.gif',
    size: createGifFile().size,
  })
  const file = await selectImage()
  await save().click()
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('common.imageUploader.uploadFromComputerUploadError')
  await expect.element(saved()).toHaveTextContent(JSON.stringify(defaultIcon))
  await save().click()
  await expectSavedImage('retried-image', file)
})

it('ignores an upload that finishes after Cancel and preserves a newly opened draft', async () => {
  await page.viewport(640, 600)
  const request = createDeferred<PostFilesUploadResponse>()
  uploadImage.mockReturnValueOnce(request.promise)
  const file = await selectImage()
  await save().click()
  await expect.poll(() => uploadImage.mock.calls.length).toBe(1)
  await page.getByRole('button', { name: 'app.iconPicker.cancel' }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  const trigger = page.getByRole('button', { name: 'Choose icon' })
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('radio', { name: 'app.iconPicker.color.green' }).click()
  request.resolve({ id: 'late-image', name: file.name, size: file.size })
  await request.promise
  await page.getByRole('combobox', { name: 'app.iconPicker.search' }).fill('new draft')
  await expect.element(dialog()).toBeVisible()
  await expect.element(saved()).toHaveTextContent(JSON.stringify(defaultIcon))
  await expect
    .element(page.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    .toBeChecked()
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect
    .element(saved())
    .toHaveTextContent(JSON.stringify({ ...defaultIcon, background: '#F3FEE7' }))
  expect(uploadImage).toHaveBeenCalledTimes(1)
})

it('keeps an existing image when browsing produces no valid replacement', async () => {
  await page.viewport(640, 600)
  const value = { type: 'image' as const, fileId: 'existing', url: gifDataUrl }
  await setup(value)
  const change = page.getByRole('button', { name: 'common.operation.change' })
  await expect.element(change).toHaveFocus()
  const input = page.getByTestId('image-input')
  await expect.element(input).toBeInTheDocument()
  await expect
    .element(dialog().getByRole('img', { name: 'app.iconPicker.image' }))
    .toHaveAttribute('src', value.url)
  await input.upload(new File(['text'], 'invalid.txt', { type: 'text/plain' }))
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('common.imageInput.supportedFormats')
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(saved()).toHaveTextContent(JSON.stringify(value))
  expect(uploadImage).not.toHaveBeenCalled()
})

it('allows retry after the browser refuses to read the image preview', async () => {
  await page.viewport(640, 600)
  const file = await selectImage()
  // boundary: force the browser FileReader failure that the retry UI must recover from.
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementationOnce(function (
    this: FileReader,
  ) {
    this.dispatchEvent(new Event('error'))
  })
  await save().click()
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('common.imageUploader.uploadFromComputerReadError')
  await expect.element(save()).toBeEnabled()
  expect(uploadImage).not.toHaveBeenCalled()
  read.mockRestore()
  uploadImage.mockResolvedValueOnce({ id: 'read-retry', name: file.name, size: file.size })
  await save().click()
  await expectSavedImage('read-retry', file)
})

it('resolves a missing emoji background only when the caller confirms', async () => {
  await page.viewport(640, 600)
  await setup({ type: 'emoji', icon: '😀' })
  await expect.element(saved()).toHaveTextContent(JSON.stringify({ type: 'emoji', icon: '😀' }))
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(saved()).toHaveTextContent(JSON.stringify(defaultIcon))
})

it('keeps current edits across a committed-prop update and reads that update on reopening', async () => {
  await page.viewport(640, 600)
  const { Wrapper } = createIconPickerEnvironment()
  function Consumer({ value }: { value: IconPickerInputValue }) {
    // Consumer persistence is independent of the public committed value supplied to the picker.
    const [accepted, setAccepted] = useState<IconPickerValue>()
    return (
      <>
        <IconPicker value={value} onValueChange={setAccepted}>
          <IconPickerTrigger aria-label="Choose icon">
            <IconPickerIcon />
          </IconPickerTrigger>
          <IconPickerContent />
        </IconPicker>
        <output aria-label="Accepted icon">{JSON.stringify(accepted)}</output>
      </>
    )
  }
  const view = await render(
    <Wrapper>
      <Consumer value={defaultIcon} />
    </Wrapper>,
  )
  await page.getByRole('button', { name: 'Choose icon' }).click()
  await page.getByRole('radio', { name: 'app.iconPicker.color.green' }).click()
  const next = { type: 'image' as const, fileId: 'remote-image', url: gifDataUrl }
  await view.rerender(
    <Wrapper>
      <Consumer value={next} />
    </Wrapper>,
  )
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Accepted icon' }))
    .toHaveTextContent(JSON.stringify({ ...defaultIcon, background: '#F3FEE7' }))
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('tab', { name: 'app.iconPicker.image' }))
    .toHaveAttribute('aria-selected', 'true')
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Accepted icon' }))
    .toHaveTextContent(JSON.stringify(next))
  expect(uploadImage).not.toHaveBeenCalled()
})

it.each(['upload', 'preview'] as const)(
  'clears a %s failure on replacement and saves that replacement',
  async (failure) => {
    await page.viewport(640, 600)
    await selectImage()
    let restoreRead: (() => void) | undefined
    if (failure === 'upload') uploadImage.mockRejectedValueOnce(new Error('Upload failed'))
    else {
      // boundary: force the browser FileReader failure cleared by choosing a replacement.
      const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementationOnce(function (
        this: FileReader,
      ) {
        this.dispatchEvent(new Event('error'))
      })
      restoreRead = () => read.mockRestore()
    }
    await save().click()
    await expect.element(page.getByRole('alert')).toBeVisible()
    restoreRead?.()
    await page.getByRole('button', { name: 'common.operation.change' }).click()
    const replacement = createGifFile('replacement.gif')
    await page.getByTestId('image-input').upload(replacement)
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    uploadImage.mockResolvedValueOnce({
      id: 'replacement',
      name: replacement.name,
      size: replacement.size,
    })
    await save().click()
    await expectSavedImage('replacement', replacement)
    expect(uploadImage.mock.lastCall![0].body.file).toMatchObject({ name: 'replacement.gif' })
  },
)

it('blocks replacement during upload and restores the original draft after failure', async () => {
  await page.viewport(640, 600)
  const request = createDeferred<PostFilesUploadResponse>()
  uploadImage.mockReturnValueOnce(request.promise)
  const file = await selectImage()
  await save().click()
  const change = page.getByRole('button', { name: 'common.operation.change' })
  await expect.element(change).toBeDisabled()
  await expect.element(page.getByTestId('image-input')).toBeDisabled()
  const cancel = page.getByRole('button', { name: 'app.iconPicker.cancel' })
  await expect.element(cancel).toBeEnabled()
  // Native Tab skips the disabled picker controls, without forcing a disabled upload/click.
  await userEvent.tab()
  await expect.element(page.getByRole('tab', { name: 'app.iconPicker.image' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(cancel).toHaveFocus()
  await dropFixtureFile(
    dialog().getByRole('img', { name: 'app.iconPicker.image' }),
    'test/fixtures/media/preview.gif',
  )
  request.reject(new Error('Upload failed'))
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect.element(change).toBeEnabled()
  uploadImage.mockResolvedValueOnce({ id: 'original', name: file.name, size: file.size })
  await save().click()
  await expectSavedImage('original', file)
  expect(uploadImage.mock.lastCall![0].body.file).toMatchObject({ name: 'icon.gif' })
})

it('replaces the committed image only after selecting and confirming the new file', async () => {
  await page.viewport(640, 600)
  const previous = { type: 'image' as const, fileId: 'existing', url: gifDataUrl }
  const file = await selectImage(previous)
  await expect.element(saved()).toHaveTextContent(JSON.stringify(previous))
  uploadImage.mockResolvedValueOnce({ id: 'new-image', name: file.name, size: file.size })
  await save().click()
  await expectSavedImage('new-image', file)
})

it('preserves a decoded linked icon on cancellation and replaces it only after confirmation', async () => {
  await page.viewport(640, 600)
  const value = { type: 'link' as const, url: gifDataUrl }
  await setup(value)
  await page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(saved()).toHaveTextContent(JSON.stringify(value))
  const image = page.getByRole('img', { name: 'Saved icon preview' })
  await expect.element(image).toBeVisible()
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(1)
  await userEvent.keyboard('{Enter}')
  await page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }).click()
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(saved()).toMatchTextContent('"type":"emoji"')
  await expect.element(image).not.toBeInTheDocument()
  expect(uploadImage).not.toHaveBeenCalled()
})

it('keeps emoji-only callers out of image upload', async () => {
  await page.viewport(640, 600)
  await setup(defaultIcon, false)
  await expect
    .element(page.getByRole('tab', { name: 'app.iconPicker.image' }))
    .not.toBeInTheDocument()
  await expect.element(page.getByTestId('image-input')).not.toBeInTheDocument()
  await save().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(saved()).toHaveTextContent(JSON.stringify(defaultIcon))
  expect(uploadImage).not.toHaveBeenCalled()
})
