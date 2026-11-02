import type { FileEntity } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageItem from '../image-item'

const file: FileEntity = {
  id: 'image-1',
  name: 'test.png',
  extension: 'png',
  mimeType: 'image/png',
  size: 1,
  progress: 100,
  base64Url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
}

it('previews the selected image and removes it without reopening its preview', async () => {
  const user = userEvent.setup()
  const onPreview = vi.fn()
  const onRemove = vi.fn()
  render(<ImageItem file={file} onPreview={onPreview} showDeleteAction onRemove={onRemove} />)
  await user.click(screen.getByRole('img', { name: 'Preview' }))
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('image-1')
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('image-1')
  expect(onPreview).toHaveBeenCalledOnce()
})

it('exposes upload progress until the image has an uploaded identifier', () => {
  const { rerender } = render(<ImageItem file={{ ...file, progress: 50 }} />)
  expect(screen.getByRole('progressbar', { name: 'custom.uploading' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  rerender(<ImageItem file={{ ...file, progress: 50, uploadedId: 'uploaded-1' }} />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
})
