import type { FileEntity } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import FileListInLog from '../file-list-in-log'

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'test.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

it('expands mixed log attachments into their variable groups and collapses them again', async () => {
  const user = userEvent.setup()
  render(
    <FileListInLog
      fileList={[
        {
          varName: 'images',
          list: [
            createFile({
              id: 'photo',
              name: 'photo.png',
              supportFileType: 'image',
              url: 'https://example.com/photo.png',
            }),
          ],
        },
        { varName: 'documents', list: [createFile({ id: 'report', name: 'report.txt' })] },
      ]}
    />,
  )
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/photo.png')
  expect(screen.queryByText('documents')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'appLog.runDetail.fileListDetail' }))
  expect(screen.getByText('images')).toBeInTheDocument()
  expect(screen.getByText('documents')).toBeInTheDocument()
  expect(screen.getByText('photo.png')).toBeInTheDocument()
  expect(screen.getByText('report.txt')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'appLog.runDetail.fileListLabel' }))
  expect(screen.queryByText('documents')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'appLog.runDetail.fileListDetail' }),
  ).toBeInTheDocument()
})

it('omits the attachment disclosure when no files were logged', () => {
  render(<FileListInLog fileList={[]} />)
  expect(
    screen.queryByRole('button', { name: 'appLog.runDetail.fileListDetail' }),
  ).not.toBeInTheDocument()
})
