import type { FileEntity } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { TransferMethod } from '@/types/app'
import { fileUpload } from '../../utils'
import FileUploaderInAttachmentWrapper from '../index'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/' }))
vi.mock('../../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils')>()),
  fileUpload: vi.fn(),
}))
const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  allowed_file_types: ['document'],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
})
const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'report.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

it.each([TransferMethod.local_file, TransferMethod.remote_url])(
  'offers only the configured upload method %s',
  (method) => {
    render(
      <FileUploaderInAttachmentWrapper
        onChange={vi.fn()}
        fileConfig={createFileConfig({ allowed_file_upload_methods: [method] })}
      />,
    )
    const local = screen.queryByRole('button', { name: /fileUploader.uploadFromComputer/ })
    const remote = screen.queryByRole('button', { name: /fileUploader.pasteFileLink/ })
    expect(method === TransferMethod.local_file ? local : remote).toBeInTheDocument()
    expect(method === TransferMethod.local_file ? remote : local).not.toBeInTheDocument()
  },
)

it('removes a file from the list, emits the remaining files, and releases the upload limit', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const remaining = createFile({ id: 'second', name: 'remaining.txt' })
  render(
    <FileUploaderInAttachmentWrapper
      value={[createFile(), remaining]}
      onChange={onChange}
      fileConfig={createFileConfig({ number_limits: 2 })}
    />,
  )
  const local = screen.getByRole('button', { name: /fileUploader.uploadFromComputer/ })
  const remote = screen.getByRole('button', { name: /fileUploader.pasteFileLink/ })
  expect(local).toBeDisabled()
  expect(remote).toBeDisabled()
  await user.click(screen.getByRole('button', { name: /remove.*report.txt/i }))
  expect(screen.queryByText('report.txt')).not.toBeInTheDocument()
  expect(screen.getByText('remaining.txt')).toBeInTheDocument()
  expect(onChange).toHaveBeenLastCalledWith([remaining])
  expect(local).toBeEnabled()
  expect(remote).toBeEnabled()
})

it('shows existing files without upload or delete actions when disabled', () => {
  render(
    <FileUploaderInAttachmentWrapper
      value={[createFile()]}
      onChange={vi.fn()}
      fileConfig={createFileConfig()}
      isDisabled
    />,
  )
  expect(screen.getByText('report.txt')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', {
      name: /fileUploader.uploadFromComputer|fileUploader.pasteFileLink|remove/i,
    }),
  ).not.toBeInTheDocument()
})

it('opens and dismisses the real remote-file input', async () => {
  const user = userEvent.setup()
  render(<FileUploaderInAttachmentWrapper onChange={vi.fn()} fileConfig={createFileConfig()} />)
  await user.click(screen.getByRole('button', { name: /fileUploader.pasteFileLink/ }))
  expect(await screen.findByRole('textbox')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('retries the original file and stores the successful upload id', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const file = new File(['report'], 'report.txt', { type: 'text/plain' })
  vi.mocked(fileUpload).mockImplementation(({ file, onSuccessCallback }) => {
    onSuccessCallback({
      id: 'uploaded-report',
      name: file.name,
      size: file.size,
      mime_type: file.type,
      extension: 'txt',
      created_at: 1,
      created_by: 'user-1',
      preview_url: null,
      source_url: '',
    })
  })
  render(
    <FileUploaderInAttachmentWrapper
      value={[createFile({ progress: -1, originalFile: file })]}
      onChange={onChange}
      fileConfig={createFileConfig()}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.retry report.txt' }))
  expect(fileUpload).toHaveBeenCalledWith(expect.objectContaining({ file }), false, undefined)
  expect(onChange).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: 'file-1', uploadedId: 'uploaded-report', progress: 100 }),
  ])
  expect(
    screen.queryByRole('button', { name: 'common.operation.retry report.txt' }),
  ).not.toBeInTheDocument()
})
