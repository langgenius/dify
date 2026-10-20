import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDeferred } from '@/test/deferred'
import RenameModal from '../rename-modal'

const { rename, toastError } = vi.hoisted(() => ({ rename: vi.fn(), toastError: vi.fn() }))
vi.mock('@/service/datasets', () => ({ renameDocumentName: rename }))
vi.mock('@/app/notifications', () => ({ toast: { error: toastError } }))
const props = {
  datasetId: 'dataset-1',
  documentId: 'doc-1',
  name: 'Original document',
  onClose: vi.fn(),
  onSaved: vi.fn(),
}
const renamed = { id: 'doc-1', name: 'Updated document', data_source_detail_dict: {} }

it('submits the edited document name once while saving and reports completion', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof renamed>()
  rename.mockReturnValue(pending.promise)
  render(<RenameModal {...props} />)
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  expect(input).toHaveValue(props.name)
  await user.clear(input)
  await user.type(input, 'Updated document{Enter}')
  await waitFor(() => expect(rename).toHaveBeenCalledOnce())
  await user.keyboard('{Enter}')
  expect(rename).toHaveBeenCalledOnce()
  expect(rename).toHaveBeenCalledWith({
    datasetId: 'dataset-1',
    documentId: 'doc-1',
    name: 'Updated document',
  })
  expect(props.onSaved).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
  await act(async () => pending.resolve(renamed))
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
  expect(props.onClose).toHaveBeenCalledOnce()
})

it('keeps the edited name after a failed save so the user can retry', async () => {
  const user = userEvent.setup()
  rename.mockRejectedValueOnce(new Error('API Error')).mockResolvedValue(renamed)
  render(<RenameModal {...props} />)
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  await user.clear(input)
  await user.type(input, 'Updated document')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('API Error'))
  expect(input).toHaveValue('Updated document')
  expect(props.onSaved).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
})

it('cancels an edited name without saving', async () => {
  const user = userEvent.setup()
  render(<RenameModal {...props} />)
  await user.type(
    screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' }),
    ' draft',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(props.onClose).toHaveBeenCalledOnce()
  expect(rename).not.toHaveBeenCalled()
})
