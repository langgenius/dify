import { ORPCError } from '@orpc/client'
import { billingErrorMessageKey } from '../billing-error'

describe('billingErrorMessageKey', () => {
  it.each([
    ['billing_unavailable', 503, 'errors.unavailable'],
    ['billing_request_in_progress', 429, 'errors.requestInProgress'],
    ['billing_operation_failed', 502, 'errors.operationFailed'],
  ])('maps the declared %s code', (code, status, key) => {
    expect(billingErrorMessageKey(new ORPCError(code, { defined: true, status }))).toBe(key)
  })

  it('treats undeclared errors as a generic billing failure', () => {
    expect(billingErrorMessageKey(new ORPCError('billing_unavailable', { status: 503 }))).toBe(
      'errors.operationFailed',
    )
    expect(
      billingErrorMessageKey(new ORPCError('account_not_found', { defined: true, status: 400 })),
    ).toBe('errors.operationFailed')
    expect(billingErrorMessageKey(new Error('Failed to open new window'))).toBe(
      'errors.operationFailed',
    )
  })
})
