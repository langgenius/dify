import type { FileEntity } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageItem from '../image-item'

const file: FileEntity = {
  id: 'image-1',
  name: 'photo.png',
  size: 10,
  extension: 'png',
  mimeType: 'image/png',
  progress: 50,
  base64Url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
}

it('shows pending upload progress until the server assigns an uploaded ID', () => {
  const { rerender } = render(<ImageItem file={file} />)
  expect(screen.getByRole('progressbar', { name: 'custom.uploading' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  rerender(<ImageItem file={{ ...file, progress: 100, uploadedId: 'uploaded-1' }} />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

it('retries a failed upload without opening its preview', async () => {
  const user = userEvent.setup()
  const onReUpload = vi.fn()
  const onPreview = vi.fn()
  const { container } = render(
    <ImageItem file={{ ...file, progress: -1 }} onReUpload={onReUpload} onPreview={onPreview} />,
  )
  // The legacy retry overlay has no role or accessible name; keep its interaction covered.
  const retry = container.querySelector('.bg-background-overlay-destructive')!
  expect(retry).toBeInTheDocument()
  await user.click(retry)
  expect(onReUpload).toHaveBeenCalledWith('image-1')
  expect(onPreview).not.toHaveBeenCalled()
})
