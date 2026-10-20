import type { FileItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileListItem from '../file-list-item'

it('previews the uploaded file selected by name', async () => {
  const user = userEvent.setup()
  const onPreview = vi.fn()
  const fileItem: FileItem = {
    fileID: 'file-1',
    progress: 100,
    file: Object.assign(new File(['content'], 'guide.pdf', { type: 'application/pdf' }), {
      id: 'uploaded-1',
    }),
  }
  render(<FileListItem fileItem={fileItem} onPreview={onPreview} onRemove={vi.fn()} />)
  await user.click(screen.getByText('guide.pdf'))
  expect(onPreview).toHaveBeenCalledWith(fileItem.file)
})
