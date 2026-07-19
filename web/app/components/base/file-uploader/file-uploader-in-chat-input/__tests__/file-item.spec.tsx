import type { FileEntity } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { downloadUrl } from '@/utils/download'
import FileItem from '../file-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('../../audio-preview', () => ({
  default: ({ title, url }: { title: string; url: string }) => (
    <div role="dialog" aria-label={title} data-url={url} />
  ),
}))

vi.mock('../../video-preview', () => ({
  default: ({ title, url }: { title: string; url: string }) => (
    <div role="dialog" aria-label={title} data-url={url} />
  ),
}))

vi.mock('../../dynamic-pdf-preview', () => ({
  default: ({ url, onCancel }: { url: string; onCancel: () => void }) => (
    <div role="dialog" aria-label="PDF preview" data-url={url}>
      <button type="button" onClick={onCancel}>
        Close preview
      </button>
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

describe('FileItem (chat-input)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['audio', createFile({ name: 'audio.mp3', type: 'audio/mpeg' }), 'audio.mp3'],
    ['video', createFile({ name: 'video.mp4', type: 'video/mp4' }), 'video.mp4'],
    ['PDF', createFile(), 'PDF preview'],
  ])('opens the %s preview from a named button', async (_, file, dialogName) => {
    const user = userEvent.setup()
    render(<FileItem file={file} canPreview />)

    await user.click(screen.getByRole('button', { name: `common.operation.view ${file.name}` }))

    expect(screen.getByRole('dialog', { name: dialogName })).toHaveAttribute('data-url', file.url)
  })

  it('previews a base64-only PDF from a named button', async () => {
    const user = userEvent.setup()
    const base64Url = 'data:application/pdf;base64,abc'
    render(<FileItem file={createFile({ url: undefined, base64Url })} canPreview />)

    await user.click(screen.getByRole('button', { name: 'common.operation.view document.pdf' }))

    expect(screen.getByRole('dialog', { name: 'PDF preview' })).toHaveAttribute(
      'data-url',
      base64Url,
    )
  })

  it('releases a local preview source when the preview closes', async () => {
    const user = userEvent.setup()
    const localPreviewUrl = 'blob:http://localhost/file-preview'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(localPreviewUrl)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const { unmount } = render(
      <FileItem
        file={createFile({
          url: undefined,
          base64Url: undefined,
          originalFile: new File(['PDF'], 'document.pdf', { type: 'application/pdf' }),
        })}
        canPreview
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.view document.pdf' }))
    expect(screen.getByRole('dialog', { name: 'PDF preview' })).toHaveAttribute(
      'data-url',
      localPreviewUrl,
    )

    await user.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(revokeObjectURL).toHaveBeenCalledWith(localPreviewUrl)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('releases an open local preview source when the file item unmounts', async () => {
    const user = userEvent.setup()
    const localPreviewUrl = 'blob:http://localhost/file-preview'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(localPreviewUrl)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const { unmount } = render(
      <FileItem
        file={createFile({
          url: undefined,
          base64Url: undefined,
          originalFile: new File(['PDF'], 'document.pdf', { type: 'application/pdf' }),
        })}
        canPreview
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.view document.pdf' }))
    expect(screen.getByRole('dialog', { name: 'PDF preview' })).toHaveAttribute(
      'data-url',
      localPreviewUrl,
    )

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith(localPreviewUrl)
  })

  it.each([
    ['remote URL', createFile(), 'https://example.com/document.pdf&as_attachment=true'],
    [
      'base64 URL',
      createFile({ url: undefined, base64Url: 'data:application/pdf;base64,abc' }),
      'data:application/pdf;base64,abc',
    ],
  ])('downloads the available %s from a named action', async (_, file, expectedUrl) => {
    const user = userEvent.setup()
    render(<FileItem file={file} showDownloadAction />)

    await user.click(screen.getByRole('button', { name: 'common.operation.download document.pdf' }))

    expect(downloadUrl).toHaveBeenCalledWith({
      url: expectedUrl,
      fileName: 'document.pdf',
      target: '_blank',
    })
  })

  it('removes the file from a named action', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<FileItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.remove document.pdf' }))

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('retries a failed upload from a named action', async () => {
    const user = userEvent.setup()
    const onReUpload = vi.fn()
    render(<FileItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry document.pdf' }))

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('does not expose preview or download actions without a file source', () => {
    render(
      <FileItem
        file={createFile({ url: undefined, base64Url: undefined, originalFile: undefined })}
        canPreview
        showDownloadAction
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'common.operation.view document.pdf' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.download document.pdf' }),
    ).not.toBeInTheDocument()
    expect(downloadUrl).not.toHaveBeenCalled()
  })
})
