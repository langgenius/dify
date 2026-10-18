import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import BatchModal from '../index'

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload,
}))

const render = (props: React.ComponentProps<typeof BatchModal>) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  return renderWithConsoleQuery(<BatchModal {...props} />, { queryClient })
}
const defaults = { isShow: true, docForm: ChunkingMode.text, onCancel: vi.fn(), onConfirm: vi.fn() }
const file = new File(['segment content\nFirst chunk'], 'chunks.csv', { type: 'text/csv' })
const uploaded = {
  id: 'uploaded-1',
  name: 'chunks.csv',
  size: file.size,
  extension: 'csv',
  mime_type: 'text/csv',
  created_by: 'user',
  created_at: 0,
}

it('allows running the batch only after CSV upload completes and passes the uploaded ID', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof uploaded>()
  upload.mockReturnValue(pending.promise)
  render(defaults)
  const run = screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.run' })
  expect(run).toBeDisabled()
  // This browser file-picker input is intentionally hidden.
  await user.upload(document.getElementById('fileUploader') as HTMLInputElement, file)
  expect(run).toBeDisabled()
  await act(async () => pending.resolve(uploaded))
  await waitFor(() => expect(run).toBeEnabled())
  await user.click(run)
  expect(defaults.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({
      progress: 100,
      file: expect.objectContaining({ id: 'uploaded-1' }),
    }),
  )
  expect(defaults.onCancel).toHaveBeenCalledOnce()
})

it('disables running again after removing the selected CSV', async () => {
  const user = userEvent.setup()
  upload.mockResolvedValue(uploaded)
  render(defaults)
  await user.upload(document.getElementById('fileUploader') as HTMLInputElement, file)
  const run = screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.run' })
  await waitFor(() => expect(run).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  expect(run).toBeDisabled()
  await user.click(run)
  expect(defaults.onConfirm).not.toHaveBeenCalled()
})

it('drops the selected CSV when the batch dialog is closed and reopened', async () => {
  const user = userEvent.setup()
  upload.mockResolvedValue(uploaded)
  const { rerender } = render(defaults)
  await user.upload(document.getElementById('fileUploader') as HTMLInputElement, file)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.run' }),
    ).toBeEnabled(),
  )
  rerender(<BatchModal {...defaults} isShow={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  rerender(<BatchModal {...defaults} />)
  expect(
    await screen.findByRole('button', { name: 'datasetDocuments.list.batchModal.run' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.browse' }),
  ).toBeInTheDocument()
})
