// Translate a DeviceFlowError (or any thrown value) into user-facing copy.
// Centralised so account/SSO branches surface the same words for the same
// failure mode and so a new server error code can be wired up here once —
// this maps a server code to an i18n key, then the key to translated copy.

import type { TFunction } from 'i18next'
import type deviceFlowResources from '@/i18n/en-US/device-flow.json'
import { DeviceFlowError } from '@/service/device-flow'

type DeviceFlowKey = keyof typeof deviceFlowResources

const APPROVE_KEY: Record<string, DeviceFlowKey> = {
  rate_limited: 'approveError.rateLimited',
  no_session: 'approveError.sessionExpired',
  invalid_session: 'approveError.sessionExpired',
  session_already_consumed: 'approveError.sessionConsumed',
  csrf_mismatch: 'approveError.verifyFailed',
  forbidden: 'approveError.verifyFailed',
  expired_or_unknown: 'approveError.codeInvalid',
  not_found: 'approveError.codeInvalid',
  user_code_mismatch: 'approveError.codeMismatch',
  user_code_not_pending: 'approveError.codeResolved',
  already_resolved: 'approveError.codeResolved',
  state_lost: 'approveError.flowExpired',
  approve_in_progress: 'approveError.inProgress',
  conflict: 'approveError.conflict',
  server_error: 'approveError.serverError',
}

export function approveErrorCopy(err: unknown, t: TFunction<'deviceFlow'>): string {
  if (err instanceof DeviceFlowError)
    return t(($) => $[APPROVE_KEY[err.code] ?? 'approveError.default'])
  return t(($) => $['approveError.default'])
}

// SSO-branch failures arrive as a `sso_error` query param set by the backend
// (oauth_device_sso sso-complete) when it redirects back to /device.
const SSO_ERROR_KEY: Record<string, DeviceFlowKey> = {
  email_belongs_to_dify_account: 'ssoError.emailBelongsToDifyAccount',
}

export function ssoErrorCopy(code: string, t: TFunction<'deviceFlow'>): string {
  return t(($) => $[SSO_ERROR_KEY[code] ?? 'ssoError.default'])
}

export type LookupOutcome = 'expired' | 'rate_limited' | 'failed'

export function classifyLookupError(err: unknown): LookupOutcome {
  if (err instanceof DeviceFlowError) {
    if (err.code === 'rate_limited' || err.status === 429) return 'rate_limited'
    if (err.code === 'server_error' || err.status >= 500) return 'failed'
  }
  return 'expired'
}
