import type { DocumentToRename } from '../rename-document-form'
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useQueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { documentRenameFilter } from '@/service/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { RenameDocumentForm } from '../rename-document-form'

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
}
const renamed = { id: 'doc-1', name: 'Updated document', data_source_detail_dict: {} }

const firstDocument = { id: props.documentId, name: props.name }
const secondDocument = { id: 'doc-2', name: 'Second document' }

function RenameSession({
  handle,
}: {
  handle: ReturnType<typeof createDialogHandle<DocumentToRename>>
}) {
  const queryClient = useQueryClient()
  const activeDocumentIdRef = useRef<string>(null)
  return (
    <>
      <DialogTrigger handle={handle} payload={firstDocument}>
        Rename first
      </DialogTrigger>
      <Dialog
        handle={handle}
        onOpenChange={(open, details) => {
          if (
            !open &&
            details.reason !== 'imperative-action' &&
            activeDocumentIdRef.current &&
            queryClient.isMutating(
              documentRenameFilter(props.datasetId, activeDocumentIdRef.current),
            )
          )
            details.cancel()
        }}
      >
        {({ payload }) => (
          <DialogContent>
            {payload && (
              <RenameDocumentForm
                key={payload.id}
                activeDocumentIdRef={activeDocumentIdRef}
                document={payload}
                datasetId={props.datasetId}
                onRenamed={() => handle.close()}
              />
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
async function openFirst(user: ReturnType<typeof userEvent.setup>) {
  const handle = createDialogHandle<DocumentToRename>()
  render(<RenameSession handle={handle} />)
  await user.click(screen.getByRole('button', { name: 'Rename first' }))
  return handle
}

it('submits the edited document name once while saving and reports completion', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof renamed>()
  rename.mockReturnValue(pending.promise)
  await openFirst(user)
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
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => pending.resolve(renamed))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('keeps the edited name after a failed save so the user can retry', async () => {
  const user = userEvent.setup()
  rename.mockRejectedValueOnce(new Error('API Error')).mockResolvedValue(renamed)
  await openFirst(user)
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  await user.clear(input)
  await user.type(input, 'Updated document')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('API Error'))
  expect(input).toHaveValue('Updated document')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('cancels an edited name without saving', async () => {
  const user = userEvent.setup()
  const handle = await openFirst(user)
  await user.type(
    screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' }),
    ' draft',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(rename).not.toHaveBeenCalled()
  act(() => handle.openWithPayload(secondDocument))
  expect(screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })).toHaveValue(
    'Second document',
  )
})

it('does not close a replacement draft when an earlier rename finishes', async () => {
  const user = userEvent.setup()
  const first = createDeferred<typeof renamed>()
  rename.mockReturnValueOnce(first.promise)
  const handle = await openFirst(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(rename).toHaveBeenCalledOnce())
  act(() => handle.openWithPayload(secondDocument))
  const input = screen.getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, ' draft')
  expect(input).toHaveValue('Second document draft')
  await act(async () => first.resolve(renamed))
  expect(input).toHaveValue('Second document draft')
  expect(screen.getByRole('dialog')).toBeVisible()
})

it('only locks the document whose rename is still pending, including after reopening it', async () => {
  const user = userEvent.setup()
  const request = createDeferred<typeof renamed>()
  rename.mockReturnValueOnce(request.promise)
  const handle = await openFirst(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(rename).toHaveBeenCalledOnce())

  act(() => handle.openWithPayload(secondDocument))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  act(() => handle.openWithPayload(firstDocument))
  expect(screen.getByRole('textbox')).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeVisible()
  await act(async () => request.resolve(renamed))
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
