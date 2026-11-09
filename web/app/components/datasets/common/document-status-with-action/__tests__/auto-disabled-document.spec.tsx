import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import AutoDisabledDocument from '../auto-disabled-document'

const { getLogs, enable, successToast } = vi.hoisted(() => ({
  getLogs: vi.fn(),
  enable: vi.fn(),
  successToast: vi.fn(),
}))
vi.mock('@/app/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/notifications')>()),
  toast: { success: successToast },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.autoDisableLogs.get': getLogs,
      'datasets.byDatasetId.documents.status.byAction.batch.patch': enable,
    }),
  }
})

it('offers enable only after disabled documents load, then refreshes their status', async () => {
  const user = userEvent.setup()
  const response = { document_ids: ['doc1', 'doc2'], count: 2 }
  const pending = createDeferred<typeof response>()
  getLogs.mockReturnValueOnce(pending.promise).mockResolvedValue({ document_ids: [], count: 0 })
  enable.mockResolvedValue({ result: 'success' })
  render(<AutoDisabledDocument datasetId="dataset-1" />)
  expect(screen.queryByRole('button', { name: 'dataset.enable' })).not.toBeInTheDocument()
  await act(async () => pending.resolve(response))
  await user.click(await screen.findByRole('button', { name: 'dataset.enable' }))
  expect(enable).toHaveBeenCalledWith({
    params: { dataset_id: 'dataset-1', action: 'enable' },
    query: { document_id: ['doc1', 'doc2'] },
  })
  await waitFor(() => expect(getLogs).toHaveBeenCalledTimes(2))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'dataset.enable' })).not.toBeInTheDocument(),
  )
  expect(successToast).not.toHaveBeenCalled()
})

it('does not offer enable when no documents were automatically disabled', async () => {
  getLogs.mockResolvedValue({ document_ids: [], count: 0 })
  const { queryClient } = render(<AutoDisabledDocument datasetId="dataset-1" />)
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(screen.queryByRole('button', { name: 'dataset.enable' })).not.toBeInTheDocument()
})
