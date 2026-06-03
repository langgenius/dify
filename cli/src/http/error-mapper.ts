import { BaseError, HttpClientError, newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { redactBearer } from './sanitize'

type WireFields = {
  code?: string
  message?: string
  hint?: string
}

type WireEnvelope = WireFields & {
  error?: WireFields
}

async function readBody(response: Response): Promise<{ raw: string, parsed?: WireEnvelope }> {
  let raw = ''
  try {
    raw = await response.text()
  }
  catch {
    return { raw: '' }
  }
  if (raw === '')
    return { raw }
  try {
    return { raw, parsed: JSON.parse(raw) as WireEnvelope }
  }
  catch {
    return { raw }
  }
}

export async function classifyResponse(request: Request, response: Response): Promise<BaseError> {
  const { parsed, raw } = await readBody(response.clone())
  const wire: WireFields = parsed?.error ?? parsed ?? {}
  const status = response.status
  const url = redactBearer(response.url || request.url)
  const method = request.method

  if (status === 401) {
    return HttpClientError.from(newError(
      ErrorCode.AuthExpired,
      wire.message ?? 'session expired or revoked',
    ))
      .withHint(wire.hint ?? 'run \'difyctl auth login\' to sign in again')
      .withHttpStatus(status)
      .withRequest(method, url)
  }

  if (status >= 500) {
    return HttpClientError.from(newError(
      ErrorCode.Server5xx,
      wire.message ?? `server error (HTTP ${status})`,
    ))
      .withHttpStatus(status)
      .withRequest(method, url)
      .withRawResponse(raw)
  }

  const err = HttpClientError.from(newError(
    ErrorCode.Server4xxOther,
    wire.message ?? `request failed (HTTP ${status})`,
  ))
    .withHttpStatus(status)
    .withRequest(method, url)
    .withRawResponse(raw)
  return wire.hint !== undefined ? err.withHint(wire.hint) : err
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
