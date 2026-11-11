import type { FileEntity } from '../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import audioUrl from '@/test/fixtures/media/preview.mp3?url'
import videoUrl from '@/test/fixtures/media/preview.mp4?url'
import {
  createPreviewPdf,
  guardPreviewFetch,
  hasPaintedPdfText,
} from '@/test/fixtures/preview-files'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-item'

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'document.pdf',
  size: 2048,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'uploaded-1',
  ...overrides,
})
let audioFile: File
let audioData: string
let restoreFetch: () => void
const urls: string[] = []
beforeEach(async () => {
  audioFile = new File([await (await fetch(audioUrl)).blob()], 'audio.mp3', { type: 'audio/mpeg' })
  audioData = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(audioFile)
  })
  // boundary: preview transport rejects backend requests while native local URLs stay real.
  restoreFetch = guardPreviewFetch()
})
afterEach(() => {
  for (const url of urls.splice(0)) URL.revokeObjectURL(url)
  restoreFetch()
  vi.restoreAllMocks()
})
function pdfUrl() {
  const url = URL.createObjectURL(createPreviewPdf())
  urls.push(url)
  return url
}
const action = (name: string) => page.getByRole('button', { name: `common.operation.${name}` })

it('shows file metadata and removes the selected attachment without opening a preview', async () => {
  await page.viewport(640, 480)
  const url = pdfUrl()
  function Attachments() {
    const [files, setFiles] = useState(() => [
      createFile({ url }),
      createFile({ id: 'other', name: 'keep.pdf', url }),
    ])
    return (
      <>
        {files.map((file) => (
          <FileItem
            key={file.id}
            file={file}
            canPreview
            showDeleteAction
            onRemove={(id) => setFiles((current) => current.filter((item) => item.id !== id))}
          />
        ))}
      </>
    )
  }
  await render(<Attachments />)
  const filename = page.getByText('document.pdf')
  await expect.element(filename).toBeVisible()
  await expect.element(page.getByText(/2.00 KB/).first()).toMatchTextContent(/pdf.*2.00 KB/)
  await filename.hover()
  await action('remove').click()
  await expect.element(filename).not.toBeInTheDocument()
  await expect.element(page.getByText('keep.pdf')).toBeVisible()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('retries the failed file through its caller and removes the retry action', async () => {
  await page.viewport(640, 480)
  function RetryCaller() {
    const [file, setFile] = useState(() => createFile({ progress: -1, uploadedId: undefined }))
    return (
      <FileItem
        file={file}
        canPreview
        onReUpload={(id) => {
          if (id === file.id) setFile({ ...file, progress: 50 })
        }}
      />
    )
  }
  await render(<RetryCaller />)
  await userEvent.tab()
  await expect.element(action('retry')).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(action('retry')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('progressbar', { name: 'custom.uploading' }))
    .toHaveAttribute('aria-valuenow', '50')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('downloads the file through the real anchor without opening its preview', async () => {
  await page.viewport(640, 480)
  const downloads: { href: string; name: string; target: string }[] = []
  // boundary: the browser download handoff is observable only through the activated anchor.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download, target: this.target })
  })
  await render(
    <FileItem file={createFile({ url: '/files/document.pdf' })} canPreview showDownloadAction />,
  )
  await page.getByRole('button', { name: 'document.pdf' }).hover()
  await action('download').click()
  expect(downloads).toEqual([
    {
      href: new URL('/files/document.pdf?as_attachment=true', location.href).href,
      name: 'document.pdf',
      target: '_blank',
    },
  ])
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it.each([
  { label: 'hidden action', url: '/files/document.pdf', showDownloadAction: false },
  { label: 'missing URL', url: undefined, showDownloadAction: true },
])(
  'omits unavailable downloads from native keyboard navigation: $label',
  async ({ url, showDownloadAction }) => {
    await page.viewport(640, 480)
    await render(
      <>
        <FileItem file={createFile({ url })} showDownloadAction={showDownloadAction} />
        <button>After attachment</button>
      </>,
    )
    await page.getByText('document.pdf').hover()
    await expect.element(action('download')).not.toBeInTheDocument()
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'After attachment' })).toHaveFocus()
  },
)

it('offers the inline download when no remote URL exists', async () => {
  await page.viewport(640, 480)
  await render(
    <FileItem
      file={createFile({ base64Url: 'data:application/pdf;base64,JVBERi0xLjQ=' })}
      showDownloadAction
    />,
  )
  await page.getByText('document.pdf').hover()
  await expect.element(action('download')).toBeVisible()
})

it.each([
  { label: 'unsupported format', type: 'text/plain', url: '/files/file.txt', canPreview: true },
  { label: 'no source', type: 'audio/mpeg', url: undefined, canPreview: true },
  { label: 'no permission', type: 'audio/mpeg', url: audioUrl, canPreview: false },
])(
  'keeps the filename static when preview is unavailable: $label',
  async ({ type, url, canPreview }) => {
    await page.viewport(640, 480)
    await render(
      <>
        <FileItem
          file={createFile({ name: 'filename', type, url })}
          canPreview={canPreview}
          showDownloadAction={false}
        />
        <button>After attachment</button>
      </>,
    )
    await page.getByText('filename').click()
    await expect.element(page.getByRole('button', { name: 'filename' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'After attachment' })).toHaveFocus()
  },
)

it.each([
  { name: 'audio.mp3', type: 'audio/mpeg', url: audioUrl },
  { name: 'video.mp4', type: 'video/mp4', url: videoUrl },
])(
  'opens $name with native media controls and closes without autoplay',
  async ({ name, type, url }) => {
    await page.viewport(640, 480)
    await render(<FileItem file={createFile({ name, type, url })} canPreview />)
    const trigger = page.getByRole('button', { name })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name })
    const media = dialog.getByTitle(name)
    await expect.element(media).toBeVisible()
    const element = media.element() as HTMLMediaElement
    await expect.poll(() => element.readyState).toBeGreaterThanOrEqual(1)
    expect(element.currentSrc).toBe(new URL(url, location.href).href)
    expect(element.controls).toBe(true)
    expect(element.preload).toBe('metadata')
    expect(element.autoplay).toBe(false)
    expect(element.paused).toBe(true)
    await expect.element(action('close')).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)

it('renders the actual PDF worker output and returns focus after closing', async () => {
  await page.viewport(640, 480)
  await render(<FileItem file={createFile({ url: pdfUrl() })} canPreview />)
  const trigger = page.getByRole('button', { name: 'document.pdf' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'document.pdf' })
  await expect.element(dialog.getByText('Dify local preview')).toBeVisible()
  await expect.poll(() => hasPaintedPdfText(dialog.element())).toBe(true)
  await action('close').click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('keeps a loaded Blob through upload completion and uses the remote source next time', async () => {
  await page.viewport(640, 480)
  // boundary: object URL allocation and release are browser-owned media resource effects.
  const createObjectURL = vi.spyOn(URL, 'createObjectURL')
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
  const file = createFile({ name: 'audio.mp3', type: 'audio/mpeg', originalFile: audioFile })
  const view = await render(<FileItem file={file} canPreview />)
  expect(createObjectURL).not.toHaveBeenCalled()
  const trigger = page.getByRole('button', { name: 'audio.mp3' })
  await trigger.click()
  const media = page.getByRole('dialog').getByTitle('audio.mp3')
  await expect.element(media).toBeVisible()
  await expect
    .poll(() => (media.element() as HTMLMediaElement).readyState)
    .toBeGreaterThanOrEqual(1)
  const source = (media.element() as HTMLMediaElement).currentSrc
  expect(source).toMatch(/^blob:/)
  await view.rerender(<FileItem file={{ ...file, url: audioUrl }} canPreview />)
  // currentSrc can still describe the previously decoded resource after a new source is assigned.
  // The native <source> URL must retain this session too.
  expect(media.element().querySelector('source')?.src).toBe(source)
  expect((media.element() as HTMLMediaElement).currentSrc).toBe(source)
  expect(revokeObjectURL).not.toHaveBeenCalled()
  await action('close').click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source)
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(media).toBeVisible()
  await expect
    .poll(() => (media.element() as HTMLMediaElement).currentSrc)
    .toBe(new URL(audioUrl, location.href).href)
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(revokeObjectURL).toHaveBeenCalledTimes(1)
})

it.each(['remote', 'inline'])(
  'borrows the preferred %s source without allocating or revoking it',
  async (source) => {
    await page.viewport(640, 480)
    // boundary: object URL allocation and release are browser-owned media resource effects.
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    await render(
      <FileItem
        file={createFile({
          name: 'audio.mp3',
          type: 'audio/mpeg',
          url: source === 'remote' ? audioUrl : undefined,
          base64Url: audioData,
          originalFile: audioFile,
        })}
        canPreview
      />,
    )
    await page.getByRole('button', { name: 'audio.mp3' }).click()
    const media = page.getByRole('dialog').getByTitle('audio.mp3')
    await expect.element(media).toBeVisible()
    await expect
      .poll(() => (media.element() as HTMLMediaElement).readyState)
      .toBeGreaterThanOrEqual(1)
    expect((media.element() as HTMLMediaElement).currentSrc).toBe(
      source === 'remote' ? new URL(audioUrl, location.href).href : audioData,
    )
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  },
)

it('ends the live media session when preview permission is removed', async () => {
  await page.viewport(640, 480)
  // boundary: object URL release is a browser-owned media resource effect.
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
  const file = createFile({ name: 'audio.mp3', type: 'audio/mpeg', originalFile: audioFile })
  const view = await render(<FileItem file={file} canPreview />)
  await page.getByRole('button', { name: 'audio.mp3' }).click()
  const media = page.getByRole('dialog').getByTitle('audio.mp3')
  await expect.element(media).toBeVisible()
  await expect
    .poll(() => (media.element() as HTMLMediaElement).readyState)
    .toBeGreaterThanOrEqual(1)
  const source = (media.element() as HTMLMediaElement).currentSrc
  await view.rerender(<FileItem file={file} canPreview={false} />)
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'audio.mp3' })).not.toBeInTheDocument()
  expect(revokeObjectURL).toHaveBeenCalledWith(source)
})
