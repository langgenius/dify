import type { RenameDocumentPayload } from '../rename-document-form'
import { createDialogHandle, Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDeferred } from '@/test/deferred'
import { RenameDocumentForm } from '../rename-document-form'

const { rename, toastError } = vi.hoisted(() => ({ rename: vi.fn(), toastError: vi.fn() }))
vi.mock('@/service/datasets', () => ({ renameDocumentName: rename }))
vi.mock('@/app/notifications', () => ({ toast: { error: toastError } }))
const props = {
  datasetId: 'dataset-1',
  documentId: 'doc-1',
  name: 'Original document',
  onSaved: vi.fn(),
}
const renamed = { id: 'doc-1', name: 'Updated document', data_source_detail_dict: {} }

function renderRenameDialog() {
  const handle = createDialogHandle<RenameDocumentPayload>()
  render(
    <Dialog handle={handle}>
      {({ payload }) => (
        <DialogContent>
          {payload && (
            <RenameDocumentForm
              datasetId={props.datasetId}
              documentId={payload.id}
              name={payload.name}
              onSaved={props.onSaved}
              onClose={() => handle.close()}
            />
          )}
        </DialogContent>
      )}
    </Dialog>,
  )
  act(() => handle.openWithPayload({ id: props.documentId, name: props.name }))
  return handle
}

it('submits the edited document name once while saving and reports completion', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof renamed>()
  rename.mockReturnValue(pending.promise)
  renderRenameDialog()
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
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => pending.resolve(renamed))
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('keeps the edited name after a failed save so the user can retry', async () => {
  const user = userEvent.setup()
  rename.mockRejectedValueOnce(new Error('API Error')).mockResolvedValue(renamed)
  renderRenameDialog()
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  await user.clear(input)
  await user.type(input, 'Updated document')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('API Error'))
  expect(input).toHaveValue('Updated document')
  expect(props.onSaved).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
})

it('cancels an edited name without saving', async () => {
  const user = userEvent.setup()
  const handle = renderRenameDialog()
  await user.type(
    screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' }),
    ' draft',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(rename).not.toHaveBeenCalled()
  act(() => handle.openWithPayload({ id: props.documentId, name: props.name }))
  expect(screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })).toHaveValue(
    props.name,
  )
})
