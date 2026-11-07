import { ORPCError } from '@orpc/client'
import { consoleQuery } from '@/service/console'

// Shared defaults are merged into the generated options at runtime.
const retrySetting = (failureCount: number, error: Error) => {
  const options = consoleQuery.apps.byAppId.annotationSetting.get.queryOptions({
    input: { params: { app_id: 'app-1' } },
  })
  const retry = 'retry' in options ? options.retry : undefined
  if (typeof retry !== 'function') throw new Error('expected a retry policy')
  return retry(failureCount, error)
}

describe('annotation setting query policies', () => {
  it.each([400, 403, 404])('does not retry an annotation setting answered with %i', (status) => {
    expect(retrySetting(0, new ORPCError('ERROR', { status }))).toBe(false)
  })

  it('retries other annotation setting failures up to three times', () => {
    const error = new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 })

    expect(retrySetting(2, error)).toBe(true)
    expect(retrySetting(3, error)).toBe(false)
  })
})
