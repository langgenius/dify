import type { AnnualDiscountActiveError } from '@dify/contracts/api/console/billing/types.gen'
import type {
  BillingOperationFailedError,
  BillingRequestInProgressError,
  BillingUnavailableError,
} from '@dify/contracts/api/console/compliance/types.gen'
import type { TFunction } from 'i18next'
import { isDefinedError, ORPCError } from '@orpc/client'

type BillingErrorCode = (
  | AnnualDiscountActiveError
  | BillingOperationFailedError
  | BillingRequestInProgressError
  | BillingUnavailableError
)['code']

const billingErrorMessageKeyByCode = {
  annual_discount_active: 'errors.annualDiscountActive',
  billing_operation_failed: 'errors.operationFailed',
  billing_request_in_progress: 'errors.requestInProgress',
  billing_unavailable: 'errors.unavailable',
} as const satisfies Record<BillingErrorCode, string>

function isBillingErrorCode(code: string): code is BillingErrorCode {
  return Object.hasOwn(billingErrorMessageKeyByCode, code)
}

/**
 * Declared billing failures get their billing text. Anything else is described by its request
 * error code, with the generic billing failure as the fallback.
 */
export function getBillingErrorMessage(
  error: unknown,
  t: TFunction<['billing']>,
  describeRequestError: (error: unknown, fallback?: string) => string,
) {
  if (error instanceof ORPCError && isDefinedError(error) && isBillingErrorCode(error.code)) {
    const key = billingErrorMessageKeyByCode[error.code]
    return t(($) => $[key], { ns: 'billing' })
  }
  return describeRequestError(
    error,
    t(($) => $[billingErrorMessageKeyByCode.billing_operation_failed], { ns: 'billing' }),
  )
}
