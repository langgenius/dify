import type {
  BillingOperationFailedError,
  BillingRequestInProgressError,
  BillingUnavailableError,
} from '@dify/contracts/api/console/compliance/types.gen'
import { isDefinedError, ORPCError } from '@orpc/client'

type BillingErrorCode = (
  | BillingOperationFailedError
  | BillingRequestInProgressError
  | BillingUnavailableError
)['code']

const billingErrorMessageKeyByCode = {
  billing_operation_failed: 'errors.operationFailed',
  billing_request_in_progress: 'errors.requestInProgress',
  billing_unavailable: 'errors.unavailable',
} as const satisfies Record<BillingErrorCode, string>

function isBillingErrorCode(code: string): code is BillingErrorCode {
  return Object.hasOwn(billingErrorMessageKeyByCode, code)
}

export function billingErrorMessageKey(error: unknown) {
  if (error instanceof ORPCError && isDefinedError(error) && isBillingErrorCode(error.code))
    return billingErrorMessageKeyByCode[error.code]
  return billingErrorMessageKeyByCode.billing_operation_failed
}
