import type { TFunction } from 'i18next'
import type {
  ExternalConnectionSettings,
  ExternalConnectionVerificationState,
} from './external-connection-verification'

export type ExternalConnectionFailure = {
  field?: keyof ExternalConnectionSettings
  message: string
  details?: string[]
}

/** Structured server evidence owns the diagnosis; never infer it from remote prose. */
export function externalConnectionFailure(
  verification: ExternalConnectionVerificationState,
  settings: ExternalConnectionSettings,
  hasCredential: boolean,
  t: TFunction<['agentRoster', 'common']>,
): ExternalConnectionFailure | undefined {
  if (verification.status !== 'failed') return undefined
  const { reason, subreason, card_errors: cardErrors } = verification.details ?? {}
  if (
    subreason === 'invalid_a2a_endpoint' &&
    (reason === 'connection_failed' || reason === 'invalid_agent_card')
  )
    return { field: 'endpoint', message: t(($) => $['external.connection.errors.invalidEndpoint']) }
  if (reason === 'authentication_failed') {
    if (subreason === 'access_denied')
      return { message: t(($) => $['external.connection.errors.accessDenied']) }
    if (subreason === 'authentication_required' && settings.authentication === 'none')
      return {
        field: 'authentication',
        message: t(($) => $['external.connection.errors.authenticationRequired']),
      }
    if (
      subreason === 'token_invalid_or_expired' &&
      settings.authentication === 'bearer' &&
      Boolean(settings.token || hasCredential)
    )
      return { field: 'token', message: t(($) => $['external.connection.errors.tokenExpired']) }
    return {
      field: 'authentication',
      message:
        subreason === 'unsupported_authentication'
          ? t(($) => $['external.connection.errors.unsupportedAuthentication'])
          : t(($) => $['external.connection.errors.authentication']),
    }
  }
  if (reason === 'invalid_agent_card') {
    const details =
      subreason === 'agent_card_field_invalid'
        ? cardErrors?.slice(0, 5).flatMap(({ path, code }) => {
            if (path.length > 128 || !/^[a-z][a-z\d]*(?:\[\d{1,6}\]|\.[a-z][a-z\d]*)*$/i.test(path))
              return []
            if (code === 'missing')
              return [t(($) => $['external.connection.errors.cardFieldMissing'], { path })]
            if (code === 'invalid')
              return [t(($) => $['external.connection.errors.cardFieldInvalid'], { path })]
            return []
          })
        : undefined
    return {
      message: t(($) => $['external.connection.errors.invalidAgentCard']),
      details: details && [...new Set(details)],
    }
  }
  if (reason === 'unsupported_protocol') {
    switch (subreason) {
      case 'unsupported_protocol_version':
        return { message: t(($) => $['external.connection.errors.unsupportedVersion']) }
      case 'unsupported_transport':
        return { message: t(($) => $['external.connection.errors.unsupportedTransport']) }
      case 'unsupported_required_extension':
        return { message: t(($) => $['external.connection.errors.unsupportedExtension']) }
      default:
        return { message: t(($) => $['external.connection.errors.unsupported']) }
    }
  }
  if (reason === 'connection_failed') {
    switch (subreason) {
      case 'connection_timeout':
        return { message: t(($) => $['external.connection.errors.timeout']) }
      case 'tls_error':
        return { message: t(($) => $['external.connection.errors.tls']) }
      case 'rate_limited':
        return { message: t(($) => $['external.connection.errors.rateLimited']) }
      case 'remote_service_error':
        return { message: t(($) => $['external.connection.errors.remoteService']) }
      default:
        return { message: t(($) => $['external.connection.errors.unreachable']) }
    }
  }
  return { message: t(($) => $['external.connection.errors.unknown']) }
}
