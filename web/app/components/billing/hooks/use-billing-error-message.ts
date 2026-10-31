import type {
  BillingRequestInProgressError,
  BillingUnavailableError,
} from '@dify/contracts/api/console/account/types.gen'
import { isDefinedError, ORPCError } from '@orpc/client'
import { useTranslation } from 'react-i18next'

type TransientBillingErrorCode = (BillingRequestInProgressError | BillingUnavailableError)['code']

function hasBillingErrorCode(error: unknown, code: TransientBillingErrorCode) {
  return error instanceof ORPCError && isDefinedError(error) && error.code === code
}

export function useBillingErrorMessage() {
  const { t } = useTranslation(['billing'])

  return (error: unknown) => {
    if (hasBillingErrorCode(error, 'billing_unavailable'))
      return t(($) => $['errors.unavailable'], { ns: 'billing' })
    if (hasBillingErrorCode(error, 'billing_request_in_progress'))
      return t(($) => $['errors.requestInProgress'], { ns: 'billing' })
    return t(($) => $['errors.operationFailed'], { ns: 'billing' })
  }
}
