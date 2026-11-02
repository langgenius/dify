import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import RetryButton from '../index-failed'

const { getErrorDocs, retryErrorDocs } = vi.hoisted(() => ({
  getErrorDocs: vi.fn(),
  retryErrorDocs: vi.fn(),
}))
vi.mock('@/service/datasets', () => ({ retryErrorDocs }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.errorDocs.get': getErrorDocs,
    }),
  }
})
const document = (id: string): DocumentStatusResponse => ({
  id,
  indexing_status: 'error',
  processing_started_at: null,
  parsing_completed_at: null,
  cleaning_completed_at: null,
  splitting_completed_at: null,
  completed_at: null,
  paused_at: null,
  error: 'Indexing failed',
  stopped_at: null,
  completed_segments: 0,
  total_segments: 1,
})
const errors = { total: 2, data: [document('doc1'), document('doc2')] }

describe('RetryButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getErrorDocs.mockResolvedValue(errors)
    retryErrorDocs.mockResolvedValue({ result: 'success' })
  })
  it('waits for the requested dataset error documents', async () => {
    const response = createDeferred<typeof errors>()
    getErrorDocs.mockReturnValue(response.promise)
    const { container } = render(<RetryButton datasetId="dataset-1" />)
    expect(container.firstChild).toBeNull()
    expect(getErrorDocs).toHaveBeenCalledWith({ params: { dataset_id: 'dataset-1' } })
    await act(async () => response.resolve(errors))
    expect(await screen.findByRole('button', { name: 'dataset.retry' })).toBeInTheDocument()
    expect(screen.getByText(/2/)).toBeInTheDocument()
  })
  it('renders nothing when the response contains no failures', async () => {
    getErrorDocs.mockResolvedValue({ total: 0, data: [] })
    const { container, queryClient } = render(<RetryButton datasetId="dataset-1" />)
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(container.firstChild).toBeNull()
  })
  it('retries the failed documents and refreshes their status', async () => {
    const user = userEvent.setup()
    getErrorDocs.mockResolvedValueOnce(errors).mockResolvedValue({ total: 0, data: [] })
    render(<RetryButton datasetId="dataset-1" />)
    await user.click(await screen.findByRole('button', { name: 'dataset.retry' }))
    await waitFor(() =>
      expect(retryErrorDocs).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        document_ids: ['doc1', 'doc2'],
      }),
    )
    await waitFor(() => expect(getErrorDocs).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'dataset.retry' })).not.toBeInTheDocument(),
    )
  })
  it('ignores repeated clicks while retrying', async () => {
    const user = userEvent.setup()
    const response = createDeferred<{ result: 'success' }>()
    retryErrorDocs.mockReturnValue(response.promise)
    render(<RetryButton datasetId="dataset-1" />)
    await user.click(await screen.findByRole('button', { name: 'dataset.retry' }))
    expect(screen.getByRole('button', { name: 'dataset.retry' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.retry' }))
    expect(retryErrorDocs).toHaveBeenCalledTimes(1)
    await act(async () => response.resolve({ result: 'success' }))
    await waitFor(() => expect(getErrorDocs).toHaveBeenCalledTimes(2))
  })
  it('keeps retry available after failure without refreshing history', async () => {
    const user = userEvent.setup()
    retryErrorDocs.mockRejectedValueOnce(new Error('Retry failed'))
    render(<RetryButton datasetId="dataset-1" />)
    await user.click(await screen.findByRole('button', { name: 'dataset.retry' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'dataset.retry' })).not.toBeDisabled(),
    )
    expect(getErrorDocs).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'dataset.retry' }))
    await waitFor(() => expect(retryErrorDocs).toHaveBeenCalledTimes(2))
  })
  it('shows retry when the status request fails', async () => {
    getErrorDocs.mockRejectedValue(new Error('Unavailable'))
    render(<RetryButton datasetId="dataset-1" />)
    expect(await screen.findByRole('button', { name: 'dataset.retry' })).toBeInTheDocument()
  })
  it('does not fetch without a dataset ID', () => {
    render(<RetryButton datasetId="" />)
    expect(getErrorDocs).not.toHaveBeenCalled()
  })
})
