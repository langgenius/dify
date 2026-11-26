import type { AnnualDiscountActiveError } from '@dify/contracts/api/console/billing/types.gen'
import type {
  BillingOperationFailedError,
  BillingRequestInProgressError,
  BillingUnavailableError,
} from '@dify/contracts/api/console/compliance/types.gen'
import type { TFunction } from 'i18next'
import { isDefinedError, ORPCError } from '@orpc/client'
import { getRequestErrorMessage } from '@/service/http-error'

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
 * Declared billing failures get their localized text. Anything else shows the server's message,
 * and the generic billing failure only when the server returned none.
 */
export function getBillingErrorMessage(error: unknown, t: TFunction<['billing']>) {
  if (error instanceof ORPCError && isDefinedError(error) && isBillingErrorCode(error.code)) {
    const key = billingErrorMessageKeyByCode[error.code]
    return t(($) => $[key], { ns: 'billing' })
  }
  return (
    getRequestErrorMessage(error) ??
    t(($) => $[billingErrorMessageKeyByCode.billing_operation_failed], { ns: 'billing' })
  )
}
