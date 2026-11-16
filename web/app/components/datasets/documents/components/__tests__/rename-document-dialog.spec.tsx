import type { RenameDocumentPayload } from '../rename-document-dialog'
import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { RenameDocumentDialog } from '../rename-document-dialog'

const { rename, toastError } = vi.hoisted(() => ({ rename: vi.fn(), toastError: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.rename.post': rename,
    }),
  }
})
vi.mock('@/app/notifications', () => ({ toast: { error: toastError } }))
const props = {
  datasetId: 'dataset-1',
  documentId: 'doc-1',
  name: 'Original document',
  onSaved: vi.fn(),
}
const renamed = { id: 'doc-1', name: 'Updated document', data_source_detail_dict: {} }

async function renderRenameDialog(user: ReturnType<typeof userEvent.setup>) {
  const handle = createDialogHandle<RenameDocumentPayload>()
  render(
    <>
      <DialogTrigger handle={handle} payload={{ id: props.documentId, name: props.name }}>
        Rename
      </DialogTrigger>
      <RenameDocumentDialog handle={handle} datasetId={props.datasetId} onSaved={props.onSaved} />
    </>,
  )
  await user.click(screen.getByRole('button', { name: 'Rename' }))
  return handle
}

it('submits the edited document name once while saving and reports completion', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof renamed>()
  rename.mockReturnValue(pending.promise)
  await renderRenameDialog(user)
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  expect(input).toHaveValue(props.name)
  await user.clear(input)
  await user.type(input, 'Updated document{Enter}')
  await waitFor(() => expect(rename).toHaveBeenCalledOnce())
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
  await user.keyboard('{Escape}{Enter}')
  expect(rename).toHaveBeenCalledOnce()
  expect(rename).toHaveBeenCalledWith({
    params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
    body: { name: 'Updated document' },
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
  await renderRenameDialog(user)
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
  const handle = await renderRenameDialog(user)
  await user.type(
    screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' }),
    ' draft',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(rename).not.toHaveBeenCalled()
  act(() => handle.openWithPayload({ id: 'doc-2', name: 'Second document' }))
  expect(screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })).toHaveValue(
    'Second document',
  )
})

it('does not close a replacement draft when an earlier rename finishes', async () => {
  const user = userEvent.setup()
  const first = createDeferred<typeof renamed>()
  rename.mockReturnValueOnce(first.promise)
  const handle = await renderRenameDialog(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(rename).toHaveBeenCalledOnce())
  act(() => handle.close())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  act(() => handle.openWithPayload({ id: 'doc-2', name: 'Second document' }))
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, ' draft')
  expect(input).toHaveValue('Second document draft')
  await act(async () => first.resolve(renamed))
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
  expect(input).toHaveValue('Second document draft')
  expect(screen.getByRole('dialog')).toBeVisible()
})
