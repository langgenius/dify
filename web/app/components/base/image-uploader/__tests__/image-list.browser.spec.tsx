import type { ImageFile } from '@/types/app'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import ImageList from '../image-list'
import { brokenImageUrl, imageUrl, localImage, remoteImage } from './image-fixtures'

vi.unmock('react-i18next')

function ListExample({ initial, readonly = false }: { initial: ImageFile[]; readonly?: boolean }) {
  const [files, setFiles] = useState(initial)
  const update = (id: string, progress: number) =>
    setFiles((files) => files.map((file) => (file._id === id ? { ...file, progress } : file)))
  return (
    <>
      <ImageList
        list={files}
        readonly={readonly}
        onRemove={(id) => setFiles((files) => files.filter((file) => file._id !== id))}
        onReUpload={(id) => update(id, 45)}
        onImageLinkLoadSuccess={(id) => update(id, 100)}
        onImageLinkLoadError={(id) => update(id, -1)}
      />
      <output aria-label="Current images">
        {JSON.stringify(files.map(({ _id, progress }) => ({ id: _id, progress })))}
      </output>
    </>
  )
}

async function renderList(ui: React.ReactElement) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, workflow } },
    keySeparator: false,
  })
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

it.each([
  ['local', localImage()],
  ['remote', remoteImage()],
])('opens the decoded %s image, closes the actual preview, and can reopen it', async (_, file) => {
  await page.viewport(800, 600)
  const screen = await renderList(<ListExample initial={[file]} />)
  const preview = screen.getByRole('button', { name: 'Preview image 1 of 1' })
  const thumbnail = preview.getByRole('presentation')
  await expect.element(thumbnail).toHaveAttribute('src', imageUrl)
  await expect.poll(() => (thumbnail.element() as HTMLImageElement).naturalWidth).toBe(1)
  await preview.click()
  const dialog = page.getByRole('dialog', { name: 'Preview' })
  const image = dialog.getByRole('presentation')
  await expect.element(image).toHaveAttribute('src', imageUrl)
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await preview.click()
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('removes the hovered image by its ID and updates the remaining preview position', async () => {
  await page.viewport(800, 600)
  const screen = await renderList(<ListExample initial={[localImage(), remoteImage()]} />)
  const first = screen.getByRole('button', { name: 'Preview image 1 of 2' })
  await first.hover()
  await screen.getByRole('button', { name: 'Remove' }).click()
  await expect.element(screen.getByRole('listitem')).toBeVisible()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('[{"id":"remote-image","progress":100}]')
  await expect.element(screen.getByRole('button', { name: 'Preview image 1 of 1' })).toBeVisible()
})

it('keeps readonly thumbnails previewable without exposing removal on hover', async () => {
  await page.viewport(800, 600)
  const screen = await renderList(<ListExample initial={[localImage()]} readonly />)
  await screen.getByRole('button', { name: 'Preview image 1 of 1' }).hover()
  await expect.element(screen.getByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
})

it.each([
  ['decodable', imageUrl, 1],
  ['invalid', brokenImageUrl, 0],
] as const)(
  'keeps a local upload pending and unavailable for preview with %s image bytes',
  async (_, source, width) => {
    await page.viewport(800, 600)
    const screen = await renderList(
      <ListExample initial={[localImage({ progress: 50, base64Url: source })]} readonly />,
    )
    const thumbnail = screen.getByRole('img', { name: 'sample.png' })
    await expect.element(thumbnail).toBeVisible()
    await expect.poll(() => (thumbnail.element() as HTMLImageElement).complete).toBe(true)
    expect((thumbnail.element() as HTMLImageElement).naturalWidth).toBe(width)
    await expect.element(screen.getByText('50%')).toBeVisible()
    await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('[{"id":"local-image","progress":50}]')
  },
)

it('retries the failed local file and replaces the error action with its upload progress', async () => {
  await page.viewport(800, 600)
  const screen = await renderList(<ListExample initial={[localImage({ progress: -1 })]} readonly />)
  await screen.getByRole('button', { name: 'Retry' }).click()
  await expect.element(screen.getByText('45%')).toBeVisible()
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('[{"id":"local-image","progress":45}]')
})

it('makes a remote image previewable only after native decoding succeeds', async () => {
  await page.viewport(800, 600)
  const screen = await renderList(<ListExample initial={[remoteImage({ progress: 0 })]} />)
  await expect.element(screen.getByRole('button', { name: 'Preview image 1 of 1' })).toBeVisible()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('[{"id":"remote-image","progress":100}]')
  await expect.element(screen.getByTestId('image-loader')).not.toBeInTheDocument()
})

it('keeps native decoding errors unavailable for preview and removable', async () => {
  await page.viewport(800, 600)
  const screen = await renderList(
    <ListExample initial={[remoteImage({ url: brokenImageUrl, progress: 0 })]} />,
  )
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('[{"id":"remote-image","progress":-1}]')
  await expect
    .element(screen.getByRole('button', { name: 'Preview image 1 of 1' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByTestId('image-loader')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Remove' }).click()
  await expect.element(screen.getByRole('listitem')).not.toBeInTheDocument()
})

it('does not turn a failed remote image into success when its bytes decode', async () => {
  await page.viewport(800, 600)
  const screen = await renderList(<ListExample initial={[remoteImage({ progress: -1 })]} />)
  const thumbnail = screen.getByRole('presentation')
  await expect.element(thumbnail).toBeVisible()
  await expect.poll(() => (thumbnail.element() as HTMLImageElement).naturalWidth).toBe(1)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('[{"id":"remote-image","progress":-1}]')
  await expect
    .element(screen.getByRole('button', { name: 'Preview image 1 of 1' }))
    .not.toBeInTheDocument()
})
