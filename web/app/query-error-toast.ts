import { ORPCError } from '@orpc/client'
import { getI18n } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isErrorHandled } from '@/service/handled-error'
import { getHttpErrorBodyMessage } from '@/service/http-error'

/**
 * A failed HTTP request worth reporting. Sign-in failures (401), errors the request layer
 * already presented, client exceptions and aborts are left to their owners.
 */
function getReportableRequestError(error: unknown) {
  if (!(error instanceof ORPCError) || typeof error.status !== 'number') return undefined
  if (error.status < 400 || error.status === 401 || isErrorHandled(error)) return undefined
  return error
}

const actionFailedMessage = () => getI18n().t(($) => $['api.actionFailed'], { ns: 'common' })

/**
 * Reports a failed request that a user action awaits outside TanStack Query, the same way the
 * mutation cache will. Prefer running the action through a mutation.
 */
export function toastRequestError(error: unknown, message?: string) {
  const requestError = getReportableRequestError(error)
  if (!requestError) return
  toast.error(message ?? getHttpErrorBodyMessage(requestError.data) ?? actionFailedMessage())
}
