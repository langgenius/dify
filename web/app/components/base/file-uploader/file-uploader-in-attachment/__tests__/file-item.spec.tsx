import type { FileEntity } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewMode } from '@/app/components/base/features/types'
import { TransferMethod } from '@/types/app'
import { downloadUrl } from '@/utils/download'
import FileInAttachmentItem from '../file-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ url, onCancel }: { url: string; onCancel: () => void }) => (
    <div data-testid="image-preview" data-url={url}>
      <button type="button" data-testid="close-preview" onClick={onCancel} />
    </div>
  ),
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

describe('FileInAttachmentItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads the available file source from a named action', async () => {
    const user = userEvent.setup()
    render(<FileInAttachmentItem file={createFile()} showDownloadAction />)

    await user.click(screen.getByRole('button', { name: 'common.operation.download document.pdf' }))

    expect(downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/document.pdf',
      fileName: 'document.pdf',
      target: '_blank',
    })
  })

  it('removes the file from a named action', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <FileInAttachmentItem
        file={createFile()}
        showDeleteAction
        showDownloadAction={false}
        onRemove={onRemove}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.remove document.pdf' }))

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('retries a failed upload from a named action', async () => {
    const user = userEvent.setup()
    const onReUpload = vi.fn()
    render(
      <FileInAttachmentItem
        file={createFile({ progress: -1 })}
        showDownloadAction={false}
        onReUpload={onReUpload}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.retry document.pdf' }))

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('opens a new-page preview from a keyboard-operable named button', async () => {
    const user = userEvent.setup()
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile()}
        canPreview
        previewMode={PreviewMode.NewPage}
        showDownloadAction={false}
      />,
    )

    const previewButton = screen.getByRole('button', {
      name: 'common.operation.openInNewTab document.pdf',
    })
    previewButton.focus()
    await user.keyboard('{Enter}')

    expect(windowOpen).toHaveBeenCalledWith('https://example.com/document.pdf', '_blank')
  })

  it('previews a base64-only image from a named action', async () => {
    const user = userEvent.setup()
    const base64Url = 'data:image/png;base64,abc'
    render(
      <FileInAttachmentItem
        file={createFile({
          name: 'photo.png',
          type: 'image/png',
          supportFileType: 'image',
          url: undefined,
          base64Url,
        })}
        canPreview
        showDownloadAction={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.view photo.png' }))

    expect(screen.getByTestId('image-preview')).toHaveAttribute('data-url', base64Url)
  })

  it('does not expose preview or download actions without a file source', async () => {
    const user = userEvent.setup()
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile({ url: undefined, base64Url: undefined })}
        canPreview
        previewMode={PreviewMode.NewPage}
        showDownloadAction
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'common.operation.openInNewTab document.pdf' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.download document.pdf' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByText('document.pdf'))
    expect(windowOpen).not.toHaveBeenCalled()
    expect(downloadUrl).not.toHaveBeenCalled()
  })
})
