import type { PostFilesUploadData } from '@dify/contracts/api/console/files/types.gen'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { dropFixtureFile } from '@/test/browser-file-drag'
import { createGifFile, createImageFile, readImagePixels } from '@/test/fixtures/image-files'
import { guardPreviewFetch } from '@/test/fixtures/preview-files'
import { createIconPickerEnvironment } from '@/test/icon-picker'
import { ImageIconInput } from '../image-input'
import { IconPickerCaller } from './icon-picker-caller'

const { uploadImage } = vi.hoisted(() => ({
  uploadImage:
    vi.fn<
      (
        input: Pick<PostFilesUploadData, 'body'>,
      ) => Promise<{ id: string; name: string; size: number }>
    >(),
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
  uploadImage.mockImplementation(async ({ body: { file } }) => ({
    id: 'saved-image',
    name: 'uploaded-image',
    size: file.size,
  }))
})
afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

async function openPicker() {
  const { Wrapper } = createIconPickerEnvironment()
  await render(
    <Wrapper>
      <IconPickerCaller />
    </Wrapper>,
  )
  await page.getByRole('button', { name: 'Choose icon' }).click()
  await page.getByRole('tab', { name: 'app.iconPicker.image' }).click()
}

it('crops a decoded static image into the square bytes saved by the picker', async () => {
  await page.viewport(640, 600)
  await openPicker()
  await page.getByTestId('image-input').upload(await createImageFile())
  await expect.element(page.getByRole('group', { name: 'app.iconPicker.crop' })).toBeVisible()
  await expect.element(page.getByRole('slider', { name: 'app.iconPicker.zoom' })).toBeVisible()
  const save = page.getByRole('button', { name: 'app.iconPicker.ok' })
  await expect.element(save).toBeEnabled()
  await save.click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Saved icon' }))
    .toMatchTextContent('saved-image')
  const file = uploadImage.mock.calls[0]![0].body.file
  expect(file).toMatchObject({ name: 'photo.png' })
  expect(await readImagePixels(file)).toEqual({
    width: 80,
    height: 80,
    left: [255, 0, 0, 255],
    right: [0, 0, 255, 255],
  })
})

it('preserves a GIF as the original decodable file without cropping', async () => {
  await page.viewport(640, 600)
  await openPicker()
  const file = createGifFile()
  await page.getByTestId('image-input').upload(file)
  const preview = page.getByRole('img', { name: 'app.iconPicker.image' })
  await expect.element(preview).toBeVisible()
  await expect.poll(() => (preview.element() as HTMLImageElement).naturalWidth).toBe(1)
  await expect
    .element(page.getByRole('group', { name: 'app.iconPicker.crop' }))
    .not.toBeInTheDocument()
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(new Uint8Array(await uploadImage.mock.calls[0]![0].body.file.arrayBuffer())).toEqual(
    new Uint8Array(await file.arrayBuffer()),
  )
  await expect.element(page.getByRole('img', { name: 'Saved icon preview' })).toBeVisible()
})

it('releases the selected resource on Cancel and opens a fresh image session', async () => {
  await page.viewport(640, 600)
  // boundary: object URL release is a browser-owned image resource effect.
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  await openPicker()
  await page.getByTestId('image-input').upload(createGifFile())
  const preview = page.getByRole('img', { name: 'app.iconPicker.image' })
  await expect.element(preview).toBeVisible()
  await expect.poll(() => (preview.element() as HTMLImageElement).naturalWidth).toBe(1)
  const url = (preview.element() as HTMLImageElement).src
  await page.getByRole('button', { name: 'app.iconPicker.cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(revoke).toHaveBeenCalledWith(url)
  await expect.element(page.getByRole('button', { name: 'Choose icon' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('tab', { name: 'app.iconPicker.image' }).click()
  await expect.element(page.getByRole('button', { name: 'common.imageInput.browse' })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'app.iconPicker.ok' }))
    .not.toBeInTheDocument()
})

it('invalidates an unreadable image and lets a replacement be saved', async () => {
  await page.viewport(640, 600)
  await openPicker()
  await page
    .getByTestId('image-input')
    .upload(new File(['broken'], 'photo.png', { type: 'image/png' }))
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('common.imageUploader.uploadFromComputerReadError')
  await expect
    .element(page.getByRole('button', { name: 'app.iconPicker.ok' }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'common.imageInput.browse' })).toBeVisible()
  await page.getByTestId('image-input').upload(createGifFile())
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Saved icon' }))
    .toMatchTextContent('saved-image')
})

it('accepts an external file drop on nested content without consuming text drags', async () => {
  await page.viewport(900, 700)
  function DropOwner() {
    const [outside, setOutside] = useState('No outside drop')
    const [file, setFile] = useState('No selected file')
    return (
      <>
        <button
          draggable
          onDragStart={(event) => event.dataTransfer.setData('text/plain', 'Dragged text')}
        >
          Drag text
        </button>
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) =>
            setOutside(event.dataTransfer.getData('text/plain') || 'Outside file drop')
          }
        >
          <ImageIconInput
            onChange={(value) =>
              setFile(value?.type === 'file' ? value.file.name : 'No selected file')
            }
          />
        </div>
        <output aria-label="Outside drop">{outside}</output>
        <output aria-label="Selected file">{file}</output>
      </>
    )
  }
  await render(<DropOwner />)
  const target = page.getByRole('button', { name: 'common.imageInput.browse' })
  await userEvent.dragAndDrop(page.getByRole('button', { name: 'Drag text' }), target)
  await expect
    .element(page.getByRole('status', { name: 'Outside drop' }))
    .toHaveTextContent('Dragged text')
  await expect.element(target).toBeVisible()
  await dropFixtureFile(target, 'test/fixtures/media/preview.gif')
  await expect
    .element(page.getByRole('status', { name: 'Selected file' }))
    .toHaveTextContent('preview.gif')
  const image = page.getByRole('img', { name: 'app.iconPicker.image' })
  await expect.element(image).toBeVisible()
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(1)
  await expect
    .element(page.getByRole('status', { name: 'Outside drop' }))
    .toHaveTextContent('Dragged text')
})
