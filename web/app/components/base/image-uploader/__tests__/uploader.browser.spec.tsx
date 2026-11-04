import type { ImageFile } from '@/types/app'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TransferMethod } from '@/types/app'
import Uploader from '../uploader'
import { imageFile, imageUrl } from './image-fixtures'

vi.mock('@/next/navigation', () => ({ useParams: () => ({ token: 'shared-app' }) }))
const api = vi.hoisted(() => ({
  upload:
    vi.fn<
      (options: { data: FormData }, isPublic?: boolean, url?: string) => Promise<{ id: string }>
    >(),
}))
vi.mock('@/service/base', () => ({ upload: api.upload }))

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

beforeEach(() => api.upload.mockResolvedValue({ id: 'uploaded-image' }))

it('reads native file bytes, uploads them to the public endpoint and accepts the same file again', async () => {
  await page.viewport(800, 600)
  const screen = await render(<UploaderExample />)
  const input = screen.getByLabelText('Upload image')
  const file = imageFile()
  await input.upload(file)
  const saved = screen.getByRole('status', { name: 'Uploaded image' })
  await expect.element(saved).toBeVisible()
  await expect.poll(() => JSON.parse(saved.element().textContent!).progress).toBe(100)
  const result = JSON.parse(saved.element().textContent!)
  expect(result).toMatchObject({
    fileId: 'uploaded-image',
    type: TransferMethod.local_file,
    base64Url: imageUrl,
    url: imageUrl,
  })
  await expect.element(screen.getByLabelText('Image picker')).not.toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Choose another image' })).toBeVisible()
  expect(api.upload).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.any(FormData) }),
    true,
    undefined,
  )
  const uploaded = api.upload.mock.calls[0]![0].data.get('file')
  expect(uploaded).toBeInstanceOf(File)
  expect(await (uploaded as File).bytes()).toEqual(await file.bytes())
  expect((uploaded as File).name).toBe('sample.png')

  await screen.getByRole('button', { name: 'Choose another image' }).click()
  await expect.element(input).toBeVisible()
  await input.click()
  await expect.element(input).toHaveValue('')
  api.upload.mockResolvedValueOnce({ id: 'uploaded-again' })
  await input.upload(file)
  await expect.poll(() => JSON.parse(saved.element().textContent!).fileId).toBe('uploaded-again')
  await expect.element(screen.getByLabelText('Image picker')).not.toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Choose another image' })).toBeVisible()
})

it('exposes disabled file selection without publishing or closing', async () => {
  await page.viewport(800, 600)
  const screen = await render(<UploaderExample disabled />)
  await expect.element(screen.getByLabelText('Upload image')).toBeDisabled()
  await expect.element(screen.getByRole('status', { name: 'Uploaded image' })).toBeEmptyDOMElement()
  await expect.element(screen.getByLabelText('Image picker')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Choose another image' }))
    .not.toBeInTheDocument()
  expect(api.upload).not.toHaveBeenCalled()
})
