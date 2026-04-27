// Translate a DeviceFlowError (or any thrown value) into user-facing copy.
// Centralised so account/SSO branches surface the same words for the same
// failure mode and so a new server error code can be wired up here once.

import { DeviceFlowError } from '@/service/device-flow'

const APPROVE_COPY: Record<string, string> = {
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  no_session: 'Your session has expired. Run difyctl auth login again to start over.',
  invalid_session: 'Your session has expired. Run difyctl auth login again to start over.',
  session_already_consumed: 'This session was already used. Run difyctl auth login again.',
  csrf_mismatch: 'Could not verify the request. Refresh the page and try again.',
  forbidden: 'Could not verify the request. Refresh the page and try again.',
  expired_or_unknown: 'This code is no longer valid.',
  not_found: 'This code is no longer valid.',
  user_code_mismatch: 'This code does not match the active session. Run difyctl auth login again.',
  user_code_not_pending: 'This code was already approved or denied.',
  already_resolved: 'This code was already approved or denied.',
  state_lost: 'The flow expired before approval completed. Run difyctl auth login again.',
  approve_in_progress: 'An approval is already in progress for this code.',
  conflict: 'This code is no longer in a state we can approve.',
  server_error: 'Something went wrong on our side. Try again in a moment.',
}

const DEFAULT_MESSAGE = 'Could not complete the request. Please try again.'

export function approveErrorCopy(err: unknown): string {
  if (err instanceof DeviceFlowError)
    return APPROVE_COPY[err.code] ?? DEFAULT_MESSAGE
  return DEFAULT_MESSAGE
}

export type LookupOutcome = 'expired' | 'rate_limited' | 'failed'

export function classifyLookupError(err: unknown): LookupOutcome {
  if (err instanceof DeviceFlowError) {
    if (err.code === 'rate_limited' || err.status === 429) return 'rate_limited'
    if (err.code === 'server_error' || err.status >= 500) return 'failed'
  }
  return 'expired'
}
