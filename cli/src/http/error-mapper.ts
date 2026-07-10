import type { ErrorBody } from '@dify/contracts/api/openapi/types.gen'
import type { ErrorCodeValue } from '@/errors/codes'
import { zErrorBody } from '@dify/contracts/api/openapi/zod.gen'
import { BaseError, HttpClientError, newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { redactBearer } from './sanitize'

const AUTH_EXPIRED_MESSAGE = 'session expired or revoked'
const AUTH_LOGIN_HINT = 'run \'difyctl auth login\' to sign in again'

// How one HTTP status bucket classifies: CLI code, message fallback when the
// body is not a canonical ErrorBody, optional CLI hint, raw-body retention.
type StatusClass = {
  readonly code: ErrorCodeValue
  readonly fallbackMessage: (status: number) => string
  readonly hint?: string
  readonly includeRaw: boolean
}

const AUTH_EXPIRED_CLASS: StatusClass = {
  code: ErrorCode.AuthExpired,
  fallbackMessage: () => AUTH_EXPIRED_MESSAGE,
  hint: AUTH_LOGIN_HINT,
  includeRaw: false,
}

const SERVER_5XX_CLASS: StatusClass = {
  code: ErrorCode.Server5xx,
  fallbackMessage: status => `server error (HTTP ${status})`,
  includeRaw: true,
}

const SERVER_4XX_CLASS: StatusClass = {
  code: ErrorCode.Server4xxOther,
  fallbackMessage: status => `request failed (HTTP ${status})`,
  includeRaw: true,
}

// 429 gets a dedicated CLI code (its own exit code) so wrappers can tell a rate limit from a hard
// failure. The serverError.code ("too_many_requests" / "rate_limit_error") still rides along.
const RATE_LIMITED_CLASS: StatusClass = {
  code: ErrorCode.RateLimited,
  fallbackMessage: () => 'too many requests',
  includeRaw: false,
}

const ACCESS_DENIED_CLASS: StatusClass = {
  code: ErrorCode.AccessDenied,
  fallbackMessage: () => 'not permitted',
  includeRaw: false,
}

// 426 Upgrade Required: the server rejected this difyctl as too old. Give it the
// version-compat exit code so scripts can tell it apart from a generic failure.
// The server's ErrorBody.code ("upgrade_required") + message still ride along.
const VERSION_COMPAT_CLASS: StatusClass = {
  code: ErrorCode.VersionSkew,
  fallbackMessage: () => 'client version no longer supported by the server',
  includeRaw: false,
}

function statusClass(status: number): StatusClass {
  if (status === 401)
    return AUTH_EXPIRED_CLASS
  if (status === 403)
    return ACCESS_DENIED_CLASS
  if (status === 426)
    return VERSION_COMPAT_CLASS
  if (status === 429)
    return RATE_LIMITED_CLASS
  if (status >= 500)
    return SERVER_5XX_CLASS
  return SERVER_4XX_CLASS
}

function parseServerError(raw: string): ErrorBody | undefined {
  if (raw === '')
    return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return undefined
  }
  const result = zErrorBody.safeParse(parsed)
  return result.success ? result.data : undefined
}

export async function classifyResponse(request: Request, response: Response): Promise<HttpClientError> {
  let raw = ''
  try {
    raw = await response.clone().text()
  }
  catch {
    // ignore read errors; raw stays ''
  }

  const serverError = parseServerError(raw)
  const status = response.status
  const c = statusClass(status)
  return new HttpClientError({
    code: c.code,
    message: serverError?.message ?? c.fallbackMessage(status),
    hint: c.hint,
    httpStatus: status,
    method: request.method,
    url: redactBearer(response.url || request.url),
    rawResponse: c.includeRaw && raw !== '' ? raw : undefined,
    serverError,
  })
}

export function classifyTransportError(err: unknown): BaseError {
  if (err instanceof BaseError) {
    return err
  }
  if (!(err instanceof Error)) {
    return newError(ErrorCode.Unknown, String(err)).wrap(err)
  }
  const sanitized = redactBearer(err.message)
  // there isn't a practical way to classify network errors reliably
  return newError(ErrorCode.NetworkConnection, sanitized).wrap(err)
}
