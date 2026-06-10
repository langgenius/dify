import type { ErrorBody } from '@dify/contracts/api/openapi/types.gen'
import { zErrorBody } from '@dify/contracts/api/openapi/zod.gen'
import { BaseError, HttpClientError, newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { redactBearer } from './sanitize'

const AUTH_EXPIRED_MESSAGE = 'session expired or revoked'
const AUTH_LOGIN_HINT = 'run \'difyctl auth login\' to sign in again'

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

export async function classifyResponse(request: Request, response: Response): Promise<BaseError> {
  let raw = ''
  try {
    raw = await response.clone().text()
  }
  catch {
    // ignore read errors; raw stays ''
  }

  const serverError = parseServerError(raw)
  const status = response.status
  const url = redactBearer(response.url || request.url)
  const method = request.method

  if (status === 401) {
    const base = HttpClientError.from(newError(
      ErrorCode.AuthExpired,
      serverError?.message ?? AUTH_EXPIRED_MESSAGE,
    ))
      .withHint(AUTH_LOGIN_HINT)
      .withHttpStatus(status)
      .withRequest(method, url)
    return serverError !== undefined ? base.withServerError(serverError) : base
  }

  if (status >= 500) {
    const base = HttpClientError.from(newError(
      ErrorCode.Server5xx,
      serverError?.message ?? `server error (HTTP ${status})`,
    ))
      .withHttpStatus(status)
      .withRequest(method, url)
      .withRawResponse(raw)
    return serverError !== undefined ? base.withServerError(serverError) : base
  }

  const base = HttpClientError.from(newError(
    ErrorCode.Server4xxOther,
    serverError?.message ?? `request failed (HTTP ${status})`,
  ))
    .withHttpStatus(status)
    .withRequest(method, url)
    .withRawResponse(raw)
  return serverError !== undefined ? base.withServerError(serverError) : base
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
