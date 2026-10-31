import type {
  BillingOperationFailedError,
  BillingRequestInProgressError,
  BillingUnavailableError,
} from '@dify/contracts/api/console/account/types.gen'
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

export function billingErrorMessageKey(error: unknown) {
  if (
    error instanceof ORPCError &&
    isDefinedError(error) &&
    Object.hasOwn(billingErrorMessageKeyByCode, error.code)
  )
    return billingErrorMessageKeyByCode[error.code as BillingErrorCode]
  return billingErrorMessageKeyByCode.billing_operation_failed
}
