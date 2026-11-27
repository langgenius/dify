import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TEST_DATASET_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import RetryButton from '../index-failed'

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
      <RetryButton datasetId={TEST_DATASET_ID} />
    </ConsoleQuery>,
  )
}

const fake = setupFakeApi(() => ({
  console: {
    datasets: {
      byDatasetId: {
        errorDocs: { get: async () => errors },
        retry: { post: async () => {} },
      },
    },
  },
}))

it('reveals settled failures, blocks repeated native activation and disappears after refresh', async () => {
  const retryResponse = createDeferred<void>()
  const errorDocs = fake.console.datasets.byDatasetId.errorDocs.get
  const statusResponse = hold(errorDocs)
  errorDocs.mockResolvedValue(noErrors)
  fake.console.datasets.byDatasetId.retry.post.mockReturnValue(retryResponse.promise)
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
  await expect.poll(() => fake.console.datasets.byDatasetId.retry.post).toHaveBeenCalledOnce()
  expect(fake.console.datasets.byDatasetId.retry.post).toHaveBeenCalledExactlyOnceWith({
    params: { dataset_id: TEST_DATASET_ID },
    body: { document_ids: ['doc1', 'doc2'] },
  })

  retryResponse.resolve()
  await expect.element(retry).not.toBeInTheDocument()
})

it('keeps retry available after a failed request and recovers on the next attempt', async () => {
  fake.console.datasets.byDatasetId.retry.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Retry failed' }),
  )
  fake.console.datasets.byDatasetId.errorDocs.get
    .mockResolvedValueOnce(errors)
    .mockResolvedValue(noErrors)
  const screen = await renderRetryButton()
  const retry = screen.getByRole('button', { name: 'dataset.retry' })

  await retry.click()
  await expect.element(retry).toBeEnabled()
  await retry.click()
  await expect.element(retry).not.toBeInTheDocument()
  expect(fake.console.datasets.byDatasetId.retry.post).toHaveBeenCalledTimes(2)
})

it('offers recovery when loading the failed-document status itself fails', async () => {
  fake.console.datasets.byDatasetId.errorDocs.get.mockRejectedValue(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' }),
  )
  const screen = await renderRetryButton()

  await expect.element(screen.getByRole('button', { name: 'dataset.retry' })).toBeVisible()
})
