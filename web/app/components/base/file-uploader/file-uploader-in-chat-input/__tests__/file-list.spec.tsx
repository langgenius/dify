import type { FileEntity } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { FileContextProvider } from '../../store'
import { FileListInChatInput } from '../file-list'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/' }))

it('removes the selected attachment from a mixed chat file list and reports the remaining files', async () => {
  const user = userEvent.setup()
  const files: FileEntity[] = [
    {
      id: 'photo',
      name: 'photo.png',
      type: 'image/png',
      size: 1024,
      progress: 100,
      transferMethod: TransferMethod.local_file,
      supportFileType: 'image',
      base64Url: 'data:image/png;base64,abc',
    },
    {
      id: 'document',
      name: 'document.pdf',
      type: 'application/pdf',
      size: 2048,
      progress: 100,
      transferMethod: TransferMethod.local_file,
      supportFileType: 'document',
    },
  ]
  const config: FileUpload = { enabled: true, allowed_file_types: ['image', 'document'] }
  const onChange = vi.fn()
  render(
    <FileContextProvider value={files} onChange={onChange}>
      <FileListInChatInput fileConfig={config} />
    </FileContextProvider>,
  )
  expect(screen.getByRole('img')).toBeInTheDocument()
  expect(screen.getByText('document.pdf')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]!)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('document.pdf')).toBeInTheDocument()
  expect(onChange).toHaveBeenLastCalledWith([files[1]])
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(screen.queryByText('document.pdf')).not.toBeInTheDocument()
  expect(onChange).toHaveBeenLastCalledWith([])
})
