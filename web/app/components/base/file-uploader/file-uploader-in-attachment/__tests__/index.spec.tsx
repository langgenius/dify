import type { FileEntity } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { TransferMethod } from '@/types/app'
import { fileUpload } from '../../utils'
import FileUploaderInAttachmentWrapper from '../index'

// oxlint-disable-next-line typescript/no-deprecated -- Defer the generated client's transport response to test uploads across session changes.
const request = vi.hoisted(() => vi.fn<typeof import('@/service/base').request>())
vi.mock('@/service/base', () => ({ request }))
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

it('ignores pending local upload progress and results after switching uploader sessions', async () => {
  const user = userEvent.setup()
  vi.mocked(fileUpload).mockReset()
  const showError = vi.spyOn(toast, 'error').mockReturnValue('toast-id')
  const onChange = vi.fn()
  const fileConfig = createFileConfig()
  const { rerender } = render(
    <FileUploaderInAttachmentWrapper key="old" onChange={onChange} fileConfig={fileConfig} />,
  )
  const button = screen.getByRole('button', { name: /fileUploader.uploadFromComputer/ })
  const input = button.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(input, [
    new File(['first'], 'pending-first.txt', { type: 'text/plain' }),
    new File(['second'], 'pending-second.txt', { type: 'text/plain' }),
  ])
  await waitFor(() => expect(fileUpload).toHaveBeenCalledTimes(2))
  expect(screen.getByText('pending-first.txt')).toBeInTheDocument()
  expect(screen.getByText('pending-second.txt')).toBeInTheDocument()

  const currentFile = createFile({ id: 'current', name: 'current.txt' })
  rerender(
    <FileUploaderInAttachmentWrapper
      key="current"
      value={[currentFile]}
      onChange={onChange}
      fileConfig={fileConfig}
    />,
  )
  onChange.mockClear()
  const [successful, failed] = vi.mocked(fileUpload).mock.calls.map(([callbacks]) => callbacks)
  act(() => {
    successful!.onProgressCallback(50)
    successful!.onSuccessCallback({
      id: 'old-upload',
      name: 'pending-first.txt',
      size: 5,
      mime_type: 'text/plain',
      extension: 'txt',
      created_at: 1,
      created_by: 'user-1',
      preview_url: null,
      source_url: '',
    })
    failed!.onErrorCallback(new Error('Old upload failed'))
  })

  expect(onChange).not.toHaveBeenCalled()
  expect(showError).not.toHaveBeenCalled()
  expect(screen.getByText(currentFile.name)).toBeInTheDocument()
  expect(screen.queryByText('pending-first.txt')).not.toBeInTheDocument()
  showError.mockRestore()
})

it.each(['success', 'failure'] as const)(
  'ignores a pending remote upload %s after switching uploader sessions',
  async (outcome) => {
    const user = userEvent.setup()
    const pending = createDeferred<Response>()
    request.mockReset().mockReturnValue(pending.promise)
    const showError = vi.spyOn(toast, 'error').mockReturnValue('toast-id')
    const onChange = vi.fn()
    const fileConfig = createFileConfig()
    const { rerender, queryClient } = render(
      <FileUploaderInAttachmentWrapper key="old" onChange={onChange} fileConfig={fileConfig} />,
    )
    await user.click(screen.getByRole('button', { name: /fileUploader.pasteFileLink/ }))
    await user.type(screen.getByRole('textbox'), 'https://example.com/old.txt')
    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    expect(onChange).toHaveBeenCalled()

    const currentFile = createFile({ id: 'current', name: 'current.txt' })
    rerender(
      <FileUploaderInAttachmentWrapper
        key="current"
        value={[currentFile]}
        onChange={onChange}
        fileConfig={fileConfig}
      />,
    )
    onChange.mockClear()
    await act(async () => {
      if (outcome === 'failure') pending.reject(new Error('Old upload failed'))
      else
        pending.resolve(
          Response.json({
            id: 'old-upload',
            name: 'old.txt',
            size: 10,
            mime_type: 'text/plain',
            url: 'https://example.com/old.txt',
          }),
        )
    })
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))

    expect(screen.getByText(currentFile.name)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    showError.mockRestore()
  },
)
