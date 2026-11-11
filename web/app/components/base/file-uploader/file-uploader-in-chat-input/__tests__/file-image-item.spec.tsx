import type { FileEntity } from '../../types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { downloadUrl } from '@/utils/download'
import FileImageItem from '../file-image-item'

vi.mock('@/utils/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/download')>()),
  downloadUrl: vi.fn(),
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

beforeEach(() => vi.clearAllMocks())

it.each([undefined, 'data:image/png;base64,abc'])(
  'previews the preferred image source (local=%s) and dismisses the preview',
  async (base64Url) => {
    const user = userEvent.setup()
    render(<FileImageItem file={createFile({ base64Url })} canPreview />)
    const expectedSource = base64Url ?? 'https://example.com/photo.png'
    expect(screen.getByRole('img')).toHaveAttribute('src', expectedSource)
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.view photo.png' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(
      within(screen.getByRole('dialog', { name: 'photo.png' })).getByRole('img'),
    ).toHaveAttribute('src', expectedSource)
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
)

it('does not offer preview or remove actions when disabled by its owner', () => {
  render(<FileImageItem file={createFile()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('removes the selected image and downloads from keyboard-accessible controls', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  render(
    <FileImageItem file={createFile()} showDeleteAction showDownloadAction onRemove={onRemove} />,
  )
  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.remove' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('file-1')
  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.download' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(downloadUrl).toHaveBeenCalledExactlyOnceWith({
    url: 'https://example.com/photo.png?as_attachment=true',
    fileName: 'photo.png',
    target: '_blank',
  })
})

it('shows upload progress, then retries the failed file', async () => {
  const user = userEvent.setup()
  const onReUpload = vi.fn()
  const { rerender } = render(
    <FileImageItem
      file={createFile({ progress: 50, uploadedId: undefined })}
      onReUpload={onReUpload}
    />,
  )
  expect(screen.getByRole('progressbar', { name: 'custom.uploading' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  rerender(
    <FileImageItem
      file={createFile({ progress: -1, uploadedId: undefined })}
      onReUpload={onReUpload}
    />,
  )
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(onReUpload).toHaveBeenCalledExactlyOnceWith('file-1')
})

it.each([
  ['https://example.com/photo.png', 'https://example.com/photo.png?as_attachment=true'],
  [
    'https://example.com/photo.png?sign=a%2Fb#preview',
    'https://example.com/photo.png?sign=a%2Fb&as_attachment=true#preview',
  ],
  [
    'https://example.com/photo.png?as_attachment=false&sign=abc',
    'https://example.com/photo.png?as_attachment=true&sign=abc',
  ],
  [undefined, 'data:image/png;base64,abc'],
])('downloads %s without corrupting the path, signature or fragment', async (url, expected) => {
  const user = userEvent.setup()
  render(<FileImageItem file={createFile({ url })} showDownloadAction />)
  await user.tab()
  await user.keyboard('{Enter}')
  expect(downloadUrl).toHaveBeenCalledExactlyOnceWith({
    url: expected,
    fileName: 'photo.png',
    target: '_blank',
  })
})
