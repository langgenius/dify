import type { TFunction } from 'i18next'
import { ORPCError } from '@orpc/client'
import { createHttpError } from '@/service/http-error'
import { withSelectorKey } from '@/test/i18n-mock'
import { getBillingErrorMessage } from '../billing-error'

const t = withSelectorKey((key: string) => key) as unknown as TFunction<['billing']>

describe('getBillingErrorMessage', () => {
  it.each([
    ['annual_discount_active', 409, 'errors.annualDiscountActive'],
    ['billing_unavailable', 503, 'errors.unavailable'],
    ['billing_request_in_progress', 429, 'errors.requestInProgress'],
    ['billing_operation_failed', 502, 'errors.operationFailed'],
  ])('maps the declared %s code', (code, status, key) => {
    expect(getBillingErrorMessage(new ORPCError(code, { defined: true, status }), t)).toBe(key)
  })

  it('shows the server message for undeclared errors', () => {
    const error = createHttpError(new Response(null, { status: 400 }), {
      code: 'account_not_found',
      message: 'Account not found.',
    })
    expect(getBillingErrorMessage(error, t)).toBe('Account not found.')
  })

  it('falls back to a generic billing failure when the server returned no message', () => {
    expect(getBillingErrorMessage(new ORPCError('billing_unavailable', { status: 503 }), t)).toBe(
      'errors.operationFailed',
    )
    expect(getBillingErrorMessage(new Error('Failed to open new window'), t)).toBe(
      'errors.operationFailed',
    )
  })
})
