import type { IpEntryErrorCode } from './validate-ip-entry'
import type {
  IpPolicyFormContext,
  IpPolicyValidationError,
} from '@/features/network-access/analytics'
import { trackNetworkAccessEvent } from '@/features/network-access/analytics'
import { validateIpEntry } from './validate-ip-entry'

const VALIDATION_ERRORS = {
  octetRange: 'octet_out_of_range',
  leadingZeros: 'leading_zero',
  invalidIpv6: 'invalid_ipv6',
  prefixNotNumber: 'prefix_not_number',
  prefixRange: 'prefix_out_of_range',
  multipleSlashes: 'multiple_slash',
  unsupported: 'unsupported_format',
} as const satisfies Record<IpEntryErrorCode, IpPolicyValidationError>

export type IpPolicyFormSession = {
  context: IpPolicyFormContext
  validationErrors: Set<IpPolicyValidationError>
}

export function startIpPolicyForm(context: IpPolicyFormContext): IpPolicyFormSession {
  trackNetworkAccessEvent('ip_policy_interaction', { action: 'form_opened', ...context })
  return { context, validationErrors: new Set() }
}

export function recordPolicyValidation(session: IpPolicyFormSession, entries: readonly string[]) {
  entries.forEach((entry) => {
    const result = validateIpEntry(entry)
    if (result.kind === 'invalid') session.validationErrors.add(VALIDATION_ERRORS[result.code])
  })
}
