import type { FileEntity } from '../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { PreviewMode } from '@/app/components/base/features/types'
import { previewImage } from '@/test/fixtures/preview-files'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import FileInAttachmentItem from '../file-item'

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'document.pdf',
  size: 2048,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'uploaded-1',
  url: 'https://example.com/document.pdf',
  ...overrides,
})
const action = (name: string, filename = 'document.pdf') =>
  page.getByRole('button', { name: `common.operation.${name} ${filename}` })

function EditableAttachments({ initialFiles }: { initialFiles: FileEntity[] }) {
  const [files, setFiles] = useState(initialFiles)
  return (
    <ul aria-label="Attachments">
      {files.map((file) => (
        <li key={file.id}>
          <FileInAttachmentItem
            file={file}
            showDeleteAction
            canPreview
            previewMode={PreviewMode.NewPage}
            onRemove={(id) => setFiles((current) => current.filter((item) => item.id !== id))}
          />
        </li>
      ))}
    </ul>
  )
}

function RetryAttachment({ file }: { file: FileEntity }) {
  const [uploadedId, setUploadedId] = useState<string>()
  return (
    <>
      <FileInAttachmentItem
        file={uploadedId ? { ...file, progress: 100, uploadedId } : file}
        canPreview
        previewMode={PreviewMode.NewPage}
        onReUpload={(id) => {
          if (id === file.id) setUploadedId(`uploaded-${id}`)
        }}
      />
      <FileInAttachmentItem file={createFile({ id: 'second', name: 'second.pdf' })} />
    </>
  )
}

function captureDownloads() {
  const downloads: { url: string; filename: string; target: string; rel: string }[] = []
  const handleClick = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLAnchorElement) || !event.target.download) return
    event.preventDefault()
    downloads.push({
      url: event.target.href,
      filename: event.target.download,
      target: event.target.target,
      rel: event.target.rel,
    })
  }
  document.addEventListener('click', handleClick, true)
  onTestFinished(() => document.removeEventListener('click', handleClick, true))
  return downloads
}

beforeEach(async () => {
  await page.viewport(800, 600)
  onTestFinished(guardUnexpectedFetch())
})
afterEach(() => vi.restoreAllMocks())

it('shows file metadata without actions the caller disabled', async () => {
  await render(<FileInAttachmentItem file={createFile()} showDownloadAction={false} />)
  await expect.element(page.getByText('document.pdf')).toBeVisible()
  await expect.element(page.getByText('pdf')).toBeVisible()
  await expect.element(page.getByText('2.00 KB')).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: /operation.remove|operation.download/ }))
    .not.toBeInTheDocument()
})

it('replaces progress with Retry on failure and applies retry to the selected attachment', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const uploading = createFile({ progress: 50, uploadedId: undefined })
  const screen = await render(<RetryAttachment file={uploading} />)
  await expect
    .element(page.getByRole('progressbar', { name: 'custom.uploading' }))
    .toHaveAttribute('aria-valuenow', '50')
  await screen.rerender(<RetryAttachment file={{ ...uploading, progress: -1 }} />)
  await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
  await action('retry').click()
  await expect.element(action('retry')).not.toBeInTheDocument()
  await expect.element(page.getByText('document.pdf')).toBeVisible()
  await expect.element(page.getByText('second.pdf')).toBeVisible()
  expect(open).not.toHaveBeenCalled()
})

it('downloads and removes the chosen file without opening its new-page preview', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const downloads = captureDownloads()
  await render(
    <EditableAttachments
      initialFiles={[createFile(), createFile({ id: 'second', name: 'second.pdf' })]}
    />,
  )
  await action('download').click()
  expect(downloads).toEqual([
    {
      url: 'https://example.com/document.pdf',
      filename: 'document.pdf',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  ])
  expect(open).not.toHaveBeenCalled()
  await action('remove').click()
  await expect.element(page.getByText('document.pdf')).not.toBeInTheDocument()
  await expect.element(page.getByText('second.pdf')).toBeVisible()
  expect(open).not.toHaveBeenCalled()
  await page.getByText('second.pdf').click()
  expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/document.pdf', '_blank')
})

it.each([
  { url: previewImage, base64Url: undefined },
  { url: undefined, base64Url: previewImage },
])(
  'decodes the attachment image and dismisses its real preview using $url / $base64Url',
  async ({ url, base64Url }) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await render(
      <FileInAttachmentItem
        file={createFile({
          name: 'photo.svg',
          type: 'image/svg+xml',
          supportFileType: 'image',
          url,
          base64Url,
        })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )
    await action('view', 'photo.svg').click()
    const dialog = page.getByRole('dialog', { name: 'photo.svg' })
    const image = dialog.getByRole('img', { name: 'photo.svg' })
    await expect.element(image).toBeVisible()
    await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(80)
    expect(open).not.toHaveBeenCalled()
    await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(action('view', 'photo.svg')).toHaveFocus()
  },
)

it('uses the local fallback URL for actual download attributes and new-page navigation', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const downloads = captureDownloads()
  await render(
    <FileInAttachmentItem
      file={createFile({ url: undefined, base64Url: previewImage })}
      canPreview
      previewMode={PreviewMode.NewPage}
    />,
  )
  await action('download').click()
  expect(downloads).toEqual([
    { url: previewImage, filename: 'document.pdf', target: '_blank', rel: 'noopener noreferrer' },
  ])
  await page.getByText('document.pdf').click()
  expect(open).toHaveBeenCalledExactlyOnceWith(previewImage, '_blank')
})

it('disables unavailable attachment actions through native keyboard focus', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const downloads = captureDownloads()
  await render(
    <>
      <button>Before attachment</button>
      <FileInAttachmentItem
        file={createFile({ supportFileType: 'image', url: undefined, base64Url: undefined })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />
      <button>After attachment</button>
    </>,
  )
  await expect.element(action('download')).toBeDisabled()
  await expect.element(action('view')).toBeDisabled()
  await page.getByRole('button', { name: 'Before attachment' }).click()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'After attachment' })).toHaveFocus()
  await page.getByText('document.pdf').click()
  expect(downloads).toEqual([])
  expect(open).not.toHaveBeenCalled()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('keeps filename navigation inactive when preview is disabled or limited to the current page', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const screen = await render(
    <FileInAttachmentItem
      file={createFile()}
      canPreview={false}
      previewMode={PreviewMode.NewPage}
    />,
  )
  await page.getByText('document.pdf').click()
  await screen.rerender(
    <FileInAttachmentItem file={createFile()} canPreview previewMode={PreviewMode.CurrentPage} />,
  )
  await page.getByText('document.pdf').click()
  expect(open).not.toHaveBeenCalled()
})
