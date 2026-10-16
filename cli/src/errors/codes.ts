export const ErrorCode = {
  NotLoggedIn: 'not_logged_in',
  AuthExpired: 'auth_expired',
  AccessDenied: 'access_denied',
  UsageInvalidFlag: 'usage_invalid_flag',
  UsageMissingArg: 'usage_missing_arg',
  InputInvalid: 'input_invalid',
  ConfigInvalidKey: 'config_invalid_key',
  ConfigInvalidValue: 'config_invalid_value',
  ConfigSchemaUnsupported: 'config_schema_unsupported',
  CatalogUnavailable: 'catalog_unavailable',
  UnknownOp: 'unknown_op',
  NetworkConnection: 'network_connection',
  RateLimited: 'rate_limited',
  ServerError: 'server_error',
  KeyringUnavailable: 'keyring_unavailable',
  Unknown: 'unknown',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export const ExitCode = {
  Success: 0,
  Generic: 1,
  Usage: 2,
  Auth: 4,
  Catalog: 6,
  // Distinct from Generic so wrappers can tell "rate limited, retry later" from a hard failure.
  RateLimited: 7,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

const CODE_TO_EXIT: Readonly<Record<ErrorCodeValue, ExitCodeValue>> = {
  not_logged_in: ExitCode.Auth,
  auth_expired: ExitCode.Auth,
  access_denied: ExitCode.Auth,
  usage_invalid_flag: ExitCode.Usage,
  usage_missing_arg: ExitCode.Usage,
  input_invalid: ExitCode.Usage,
  config_invalid_key: ExitCode.Usage,
  config_invalid_value: ExitCode.Usage,
  config_schema_unsupported: ExitCode.Catalog,
  catalog_unavailable: ExitCode.Catalog,
  unknown_op: ExitCode.Catalog,
  network_connection: ExitCode.Generic,
  rate_limited: ExitCode.RateLimited,
  server_error: ExitCode.Generic,
  keyring_unavailable: ExitCode.Generic,
  unknown: ExitCode.Generic,
}

export function exitFor(code: string): ExitCodeValue {
  return (CODE_TO_EXIT as Record<string, ExitCodeValue>)[code] ?? ExitCode.Generic
}

export const ALL_ERROR_CODES: readonly ErrorCodeValue[] = Object.values(ErrorCode)
