import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { DeviceFlowError } from '@/service/device-flow'
import { approveErrorCopy } from '../error-copy'

const t = ((select: (keys: Record<string, string>) => string) =>
  select(new Proxy({}, { get: (_, key: string) => key }))) as unknown as TFunction<['deviceFlow']>

describe('approveErrorCopy', () => {
  it.each([
    ['unauthorized', 401, 'approveError.sessionExpired'],
    ['too_many_requests', 429, 'approveError.rateLimited'],
    ['service_unavailable', 503, 'approveError.serverError'],
    ['bearer_auth_disabled', 503, 'approveError.bearerDisabled'],
  ])('maps %s (%i) to %s', (code, status, key) => {
    expect(approveErrorCopy(new DeviceFlowError(code, status), t)).toBe(key)
  })

  it('shows server-error copy for an unmapped 5xx code', () => {
    expect(approveErrorCopy(new DeviceFlowError('brand_new_code', 504), t)).toBe(
      'approveError.serverError',
    )
  })

  it('shows default copy for an unmapped 4xx code', () => {
    expect(approveErrorCopy(new DeviceFlowError('brand_new_code', 400), t)).toBe(
      'approveError.default',
    )
  })
})
