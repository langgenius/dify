import type { FileEntity } from '../../types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewMode } from '@/app/components/base/features/types'
import { TransferMethod } from '@/types/app'
import { downloadUrl } from '@/utils/download'
import FileInAttachmentItem from '../file-item'

vi.mock('@/utils/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/download')>()),
  downloadUrl: vi.fn(),
}))

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

const action = (name: string, fileName = 'document.pdf') =>
  screen.getByRole('button', { name: `common.operation.${name} ${fileName}` })

describe('FileInAttachmentItem', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('shows file metadata and only enables the requested actions', () => {
    render(<FileInAttachmentItem file={createFile()} showDownloadAction={false} />)
    expect(screen.getByText('document.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('2.00 KB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.remove/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.download/ })).not.toBeInTheDocument()
  })

  it('transitions from upload progress to retry and then uploaded state', async () => {
    const user = userEvent.setup()
    const onReUpload = vi.fn()
    const { rerender } = render(
      <FileInAttachmentItem
        file={createFile({ progress: 50, uploadedId: undefined })}
        onReUpload={onReUpload}
      />,
    )
    expect(screen.getByRole('progressbar', { name: 'custom.uploading' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    rerender(
      <FileInAttachmentItem
        file={createFile({ progress: -1, uploadedId: undefined })}
        onReUpload={onReUpload}
      />,
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await user.click(action('retry'))
    expect(onReUpload).toHaveBeenCalledExactlyOnceWith('file-1')
    rerender(<FileInAttachmentItem file={createFile()} onReUpload={onReUpload} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.retry/ })).not.toBeInTheDocument()
  })

  it('removes or downloads the file without opening its new-page preview', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onRemove = vi.fn()
    render(
      <FileInAttachmentItem
        file={createFile()}
        showDeleteAction
        onRemove={onRemove}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )
    await user.click(action('remove'))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('file-1')
    await user.click(action('download'))
    expect(downloadUrl).toHaveBeenCalledExactlyOnceWith({
      url: 'https://example.com/document.pdf',
      fileName: 'document.pdf',
      target: '_blank',
    })
    expect(open).not.toHaveBeenCalled()
    await user.click(screen.getByText('document.pdf'))
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/document.pdf', '_blank')
  })

  it('retries without opening the attachment preview', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onReUpload = vi.fn()
    render(
      <FileInAttachmentItem
        file={createFile({ progress: -1 })}
        onReUpload={onReUpload}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )
    await user.click(action('retry'))
    expect(onReUpload).toHaveBeenCalledExactlyOnceWith('file-1')
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    { url: 'https://example.com/photo.png', base64Url: undefined },
    { url: undefined, base64Url: 'data:image/png;base64,YWJj' },
  ])('opens and dismisses an image preview using $url / $base64Url', async ({ url, base64Url }) => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <FileInAttachmentItem
        file={createFile({
          name: 'photo.png',
          type: 'image/png',
          supportFileType: 'image',
          url,
          base64Url,
        })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', base64Url || url)
    await user.click(action('view', 'photo.png'))
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    expect(within(dialog).getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      url || base64Url,
    )
    expect(open).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses the local image as a fallback for download and new-page preview', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const base64Url = 'data:image/png;base64,YWJj'
    render(
      <FileInAttachmentItem
        file={createFile({ url: undefined, base64Url })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )
    await user.click(action('download'))
    expect(downloadUrl).toHaveBeenCalledExactlyOnceWith({
      url: base64Url,
      fileName: 'document.pdf',
      target: '_blank',
    })
    await user.click(screen.getByText('document.pdf'))
    expect(open).toHaveBeenCalledExactlyOnceWith(base64Url, '_blank')
  })

  it.each([undefined, ''])(
    'does not open or download a missing attachment URL (%s)',
    async (url) => {
      const user = userEvent.setup()
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(
        <FileInAttachmentItem
          file={createFile({ supportFileType: 'image', url, base64Url: url })}
          canPreview
          previewMode={PreviewMode.NewPage}
        />,
      )
      expect(action('download')).toBeDisabled()
      expect(action('view')).toBeDisabled()
      await user.click(action('download'))
      await user.click(action('view'))
      await user.click(screen.getByText('document.pdf'))
      expect(downloadUrl).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('does not open a new page when preview is disabled or uses the current page', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { rerender } = render(
      <FileInAttachmentItem
        file={createFile()}
        canPreview={false}
        previewMode={PreviewMode.NewPage}
      />,
    )
    await user.click(screen.getByText('document.pdf'))
    rerender(
      <FileInAttachmentItem file={createFile()} canPreview previewMode={PreviewMode.CurrentPage} />,
    )
    await user.click(screen.getByText('document.pdf'))
    expect(open).not.toHaveBeenCalled()
  })
})
