import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import RetryButton from '../index-failed'

const { getErrorDocs, retryErrorDocs } = vi.hoisted(() => ({
  getErrorDocs: vi.fn(),
  retryErrorDocs: vi.fn(),
}))

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
const noErrors = { total: 0, data: [] }

async function renderRetryButton() {
  const { wrapper: ConsoleQuery } = createConsoleQueryWrapper()
  return render(
    <ConsoleQuery>
      <RetryButton datasetId="dataset-1" />
    </ConsoleQuery>,
  )
}

beforeEach(() => {
  getErrorDocs.mockReset()
  retryErrorDocs.mockReset()
  getErrorDocs.mockResolvedValue(errors)
  retryErrorDocs.mockResolvedValue({ result: 'success' })
})

it('reveals settled failures, blocks repeated native activation and disappears after refresh', async () => {
  const statusResponse = createDeferred<typeof errors>()
  const retryResponse = createDeferred<{ result: 'success' }>()
  getErrorDocs.mockReturnValueOnce(statusResponse.promise).mockResolvedValue(noErrors)
  retryErrorDocs.mockReturnValue(retryResponse.promise)
  const screen = await renderRetryButton()

  await expect
    .element(screen.getByRole('button', { name: 'dataset.retry' }))
    .not.toBeInTheDocument()
  statusResponse.resolve(errors)
  const retry = screen.getByRole('button', { name: 'dataset.retry' })
  await expect.element(retry).toBeVisible()
  await expect.element(screen.getByText(/2/)).toBeVisible()

  await retry.click()
  await expect.element(retry).toBeDisabled()
  await userEvent.keyboard('{Enter}')
  expect(retryErrorDocs).toHaveBeenCalledExactlyOnceWith({
    datasetId: 'dataset-1',
    document_ids: ['doc1', 'doc2'],
  })

  retryResponse.resolve({ result: 'success' })
  await expect.element(retry).not.toBeInTheDocument()
})

it('keeps retry available after a failed request and recovers on the next attempt', async () => {
  retryErrorDocs.mockRejectedValueOnce(new Error('Retry failed'))
  getErrorDocs.mockResolvedValueOnce(errors).mockResolvedValue(noErrors)
  const screen = await renderRetryButton()
  const retry = screen.getByRole('button', { name: 'dataset.retry' })

  await retry.click()
  await expect.element(retry).toBeEnabled()
  await retry.click()
  await expect.element(retry).not.toBeInTheDocument()
  expect(retryErrorDocs).toHaveBeenCalledTimes(2)
})

it('offers recovery when loading the failed-document status itself fails', async () => {
  getErrorDocs.mockRejectedValue(new Error('Unavailable'))
  const screen = await renderRetryButton()

  await expect.element(screen.getByRole('button', { name: 'dataset.retry' })).toBeVisible()
})

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
