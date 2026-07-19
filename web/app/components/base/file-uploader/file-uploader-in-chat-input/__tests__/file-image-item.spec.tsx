import type { FileEntity } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { downloadUrl } from '@/utils/download'
import FileImageItem from '../file-image-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ title, url }: { title: string; url: string }) => (
    <div role="dialog" aria-label={title} data-url={url} />
  ),
}))

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'photo.png',
  size: 4096,
  type: 'image/png',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'image',
  uploadedId: 'uploaded-1',
  base64Url: 'data:image/png;base64,abc',
  url: 'https://example.com/photo.png',
  ...overrides,
})

describe('FileImageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews a base64-only image from a named button', async () => {
    const user = userEvent.setup()
    const base64Url = 'data:image/png;base64,abc'
    render(
      <FileImageItem
        file={createFile({ url: undefined, base64Url })}
        canPreview
        showDownloadAction
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.view photo.png' }))

    expect(screen.getByRole('dialog', { name: 'photo.png' })).toHaveAttribute('data-url', base64Url)
    expect(
      screen.getByRole('button', { name: 'common.operation.download photo.png' }),
    ).toBeInTheDocument()
  })

  it.each([
    [
      'remote URL',
      createFile({ base64Url: undefined }),
      'https://example.com/photo.png&as_attachment=true',
    ],
    ['base64 URL', createFile({ url: undefined }), 'data:image/png;base64,abc'],
  ])('downloads the available %s from a named action', async (_, file, expectedUrl) => {
    const user = userEvent.setup()
    render(<FileImageItem file={file} showDownloadAction />)

    await user.click(screen.getByRole('button', { name: 'common.operation.download photo.png' }))

    expect(downloadUrl).toHaveBeenCalledWith({
      url: expectedUrl,
      fileName: 'photo.png',
      target: '_blank',
    })
  })

  it('removes the image from a named action', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<FileImageItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.remove photo.png' }))

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('retries a failed image upload from a named action', async () => {
    const user = userEvent.setup()
    const onReUpload = vi.fn()
    render(<FileImageItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry photo.png' }))

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('does not expose preview or download actions without an image source', () => {
    render(
      <FileImageItem
        file={createFile({ url: undefined, base64Url: undefined })}
        canPreview
        showDownloadAction
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'common.operation.view photo.png' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.download photo.png' }),
    ).not.toBeInTheDocument()
    expect(downloadUrl).not.toHaveBeenCalled()
  })
})
