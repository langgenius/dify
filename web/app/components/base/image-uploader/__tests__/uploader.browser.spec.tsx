import type { ReactElement } from 'react'
import type { ImageFile } from '@/types/app'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { installFakeApi, route } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { TransferMethod } from '@/types/app'
import Uploader from '../uploader'
import { imageFile, imageUrl } from './image-fixtures'

// The public web-app upload reads its share token from the real route params.
const renderWithRoute = (ui: ReactElement) =>
  render(ui, {
    wrapper: createTestNavigation({ url: '/chat/shared-app', params: { token: 'shared-app' } })
      .NavigationProvider,
  })

function UploaderExample({ disabled = false }: { disabled?: boolean }) {
  const [file, setFile] = useState<ImageFile>()
  const [open, setOpen] = useState(true)
  return (
    <>
      <section aria-label="Image picker" hidden={!open}>
        <Uploader
          disabled={disabled}
          onUpload={setFile}
          closePopover={() => setOpen(false)}
          limit={3}
        >
          {() => <span>Upload image</span>}
        </Uploader>
      </section>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}>
          Choose another image
        </button>
      )}
      <output aria-label="Uploaded image">{file && JSON.stringify(file)}</output>
    </>
  )
}

let fake: ReturnType<typeof installFakeApi>
const uploadRoute = () => fake.route('POST', 'public', '/files/upload')
beforeEach(() => {
  // Public web-app uploads go through XMLHttpRequest to the public API, answered by the fake API.
  fake = installFakeApi({
    routes: [route('POST', 'public', '/files/upload', () => ({ id: 'uploaded-image' }))],
  })
  onTestFinished(fake)
})

it('reads native file bytes, uploads them to the public endpoint and accepts the same file again', async () => {
  await page.viewport(800, 600)
  const screen = await renderWithRoute(<UploaderExample />)
  const input = screen.getByLabelText('Upload image')
  const file = imageFile()
  await input.upload(file)
  const saved = screen.getByRole('status', { name: 'Uploaded image' })
  await expect.element(saved).toBeVisible()
  // Progress reaches 100 once the bytes are sent; the file id arrives with the response.
  await expect.poll(() => JSON.parse(saved.element().textContent!).fileId).toBe('uploaded-image')
  const result = JSON.parse(saved.element().textContent!)
  expect(result).toMatchObject({
    fileId: 'uploaded-image',
    progress: 100,
    type: TransferMethod.local_file,
    base64Url: imageUrl,
    url: imageUrl,
  })
  await expect.element(screen.getByLabelText('Image picker')).not.toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Choose another image' })).toBeVisible()
  expect(uploadRoute()).toHaveBeenCalledOnce()
  const uploaded = (uploadRoute().mock.calls[0]![0].body as FormData).get('file')
  expect(uploaded).toBeInstanceOf(File)
  expect(await (uploaded as File).bytes()).toEqual(await file.bytes())
  expect((uploaded as File).name).toBe('sample.png')

  await screen.getByRole('button', { name: 'Choose another image' }).click()
  await expect.element(input).toBeVisible()
  await input.click()
  await expect.element(input).toHaveValue('')
  uploadRoute().mockResolvedValueOnce({ id: 'uploaded-again' })
  await input.upload(file)
  await expect.poll(() => JSON.parse(saved.element().textContent!).fileId).toBe('uploaded-again')
  await expect.element(screen.getByLabelText('Image picker')).not.toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Choose another image' })).toBeVisible()
})

it('exposes disabled file selection without publishing or closing', async () => {
  await page.viewport(800, 600)
  const screen = await renderWithRoute(<UploaderExample disabled />)
  await expect.element(screen.getByLabelText('Upload image')).toBeDisabled()
  await expect.element(screen.getByRole('status', { name: 'Uploaded image' })).toBeEmptyDOMElement()
  await expect.element(screen.getByLabelText('Image picker')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Choose another image' }))
    .not.toBeInTheDocument()
  expect(uploadRoute()).not.toHaveBeenCalled()
})
