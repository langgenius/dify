import type { TFunction } from 'i18next'
import type { RequestErrorTranslator } from '@/service/request-error-message'
import { ORPCError } from '@orpc/client'
import { createHttpError } from '@/service/http-error'
import { describeRequestError } from '@/service/request-error-message'
import { withSelectorKey } from '@/test/i18n-mock'
import { getBillingErrorMessage } from '../billing-error'

const t = withSelectorKey((key: string) => key) as unknown as TFunction<['billing']>
const tRequestErrors = withSelectorKey((key: string) => key) as unknown as RequestErrorTranslator
const describeError = (error: unknown, fallback?: string) =>
  describeRequestError(error, { t: tRequestErrors, fallback })
const message = (error: unknown) => getBillingErrorMessage(error, t, describeError)

describe('getBillingErrorMessage', () => {
  it.each([
    ['annual_discount_active', 409, 'errors.annualDiscountActive'],
    ['billing_unavailable', 503, 'errors.unavailable'],
    ['billing_request_in_progress', 429, 'errors.requestInProgress'],
    ['billing_operation_failed', 502, 'errors.operationFailed'],
  ])('maps the declared %s code', (code, status, key) => {
    expect(message(new ORPCError(code, { defined: true, status }))).toBe(key)
  })

  it('translates other cataloged request error codes', () => {
    const error = createHttpError(new Response(null, { status: 400 }), {
      code: 'account_not_found',
      message: 'Account not found.',
    })
    expect(message(error)).toBe('code.account_not_found')
  })

  it('prefers the billing failure over the server message of a generic code', () => {
    const error = createHttpError(new Response(null, { status: 404 }), {
      code: 'not_found',
      message: 'Subscription not found',
    })
    expect(message(error)).toBe('errors.operationFailed')
  })

  it('falls back to a generic billing failure when the server returned no message', () => {
    expect(message(new ORPCError('billing_unavailable', { status: 503 }))).toBe(
      'errors.operationFailed',
    )
    expect(message(new Error('Failed to open new window'))).toBe('errors.operationFailed')
  })
})
