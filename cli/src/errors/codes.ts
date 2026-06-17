export const ErrorCode = {
  NotLoggedIn: 'not_logged_in',
  AuthExpired: 'auth_expired',
  TokenExpired: 'token_expired',
  AccessDenied: 'access_denied',
  ExpiredToken: 'expired_token',
  VersionSkew: 'version_skew',
  UnsupportedEndpoint: 'unsupported_endpoint',
  ConfigSchemaUnsupported: 'config_schema_unsupported',
  UsageInvalidFlag: 'usage_invalid_flag',
  UsageMissingArg: 'usage_missing_arg',
  ConfigInvalidKey: 'config_invalid_key',
  ConfigInvalidValue: 'config_invalid_value',
  NetworkConnection: 'network_connection',
  RateLimited: 'rate_limited',
  Server5xx: 'server_5xx',
  Server4xxOther: 'server_4xx_other',
  ClientError: 'client_error',
  Unknown: 'unknown',
  IllegalArgumentError: 'illegal_argument',
  KeyringUnavailable: 'keyring_unavailable',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export const ExitCode = {
  Success: 0,
  Generic: 1,
  Usage: 2,
  Auth: 4,
  VersionCompat: 6,
  // Distinct from Generic so wrappers can tell "rate limited, retry later" from a hard failure.
  RateLimited: 7,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

const CODE_TO_EXIT: Readonly<Record<ErrorCodeValue, ExitCodeValue>> = {
  not_logged_in: ExitCode.Auth,
  auth_expired: ExitCode.Auth,
  token_expired: ExitCode.Auth,
  access_denied: ExitCode.Auth,
  expired_token: ExitCode.Auth,
  version_skew: ExitCode.VersionCompat,
  unsupported_endpoint: ExitCode.VersionCompat,
  config_schema_unsupported: ExitCode.VersionCompat,
  usage_invalid_flag: ExitCode.Usage,
  usage_missing_arg: ExitCode.Usage,
  config_invalid_key: ExitCode.Usage,
  config_invalid_value: ExitCode.Usage,
  network_connection: ExitCode.Generic,
  rate_limited: ExitCode.RateLimited,
  server_5xx: ExitCode.Generic,
  server_4xx_other: ExitCode.Generic,
  client_error: ExitCode.Generic,
  unknown: ExitCode.Generic,
  illegal_argument: ExitCode.Usage,
  keyring_unavailable: ExitCode.Generic,
}

export function exitFor(code: string): ExitCodeValue {
  return (CODE_TO_EXIT as Record<string, ExitCodeValue>)[code] ?? ExitCode.Generic
}

export const ALL_ERROR_CODES: readonly ErrorCodeValue[] = Object.values(ErrorCode)
export const CODE_TO_EXIT_MAP: Readonly<Record<ErrorCodeValue, ExitCodeValue>> = CODE_TO_EXIT
