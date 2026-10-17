import { consoleQuery } from '@/service/console'
import { HttpError } from '@/service/http-error'

const detailOptions = () =>
  consoleQuery.datasets.byDatasetId.get.queryOptions({
    input: { params: { dataset_id: 'dataset-1' } },
  })

// Shared defaults are merged into the generated options at runtime.
const retryDetail = (failureCount: number, error: Error) => {
  const options = detailOptions()
  const retry = 'retry' in options ? options.retry : undefined
  if (typeof retry !== 'function') throw new Error('expected a retry policy')
  return retry(failureCount, error)
}

describe('dataset query policies', () => {
  it.each([403, 404])('does not retry a dataset detail answered with %i', (status) => {
    expect(retryDetail(0, new HttpError('ERROR', { status }))).toBe(false)
  })

  it('retries other dataset detail failures up to three times', () => {
    const error = new HttpError('INTERNAL_SERVER_ERROR', { status: 500 })

    expect(retryDetail(2, error)).toBe(true)
    expect(retryDetail(3, error)).toBe(false)
  })

  it('reads process rules once per import', () => {
    const options = consoleQuery.datasets.processRule.get.queryOptions({ input: { query: {} } })
    expect('refetchOnWindowFocus' in options ? options.refetchOnWindowFocus : undefined).toBe(false)
  })
})
