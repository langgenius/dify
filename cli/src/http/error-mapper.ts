import type { BaseError } from '../errors/base.js'
import { newError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { redactBearer } from './sanitize.js'

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
  const { parsed } = await readBody(response.clone())
  const wire: WireFields = parsed?.error ?? parsed ?? {}
  const status = response.status
  const url = redactBearer(response.url || request.url)
  const method = request.method

  if (status === 401) {
    return newError(
      ErrorCode.AuthExpired,
      wire.message ?? 'session expired or revoked',
    )
      .withHint(wire.hint ?? 'run \'difyctl auth login\' to sign in again')
      .withHttpStatus(status)
      .withRequest(method, url)
  }

  if (status >= 500) {
    return newError(
      ErrorCode.Server5xx,
      wire.message ?? `server error (HTTP ${status})`,
    )
      .withHttpStatus(status)
      .withRequest(method, url)
  }

  const err = newError(
    ErrorCode.Server4xxOther,
    wire.message ?? `request failed (HTTP ${status})`,
  )
    .withHttpStatus(status)
    .withRequest(method, url)
  return wire.hint !== undefined ? err.withHint(wire.hint) : err
}

export function classifyTransportError(err: unknown): BaseError {
  const message = err instanceof Error ? err.message : String(err)
  const sanitized = redactBearer(message)

  if (err instanceof Error && err.name === 'TimeoutError')
    return newError(ErrorCode.NetworkTimeout, 'request timed out').wrap(err)
  if (err instanceof Error && err.name === 'AbortError')
    return newError(ErrorCode.NetworkTimeout, 'request aborted').wrap(err)
  if (sanitized.toLowerCase().includes('econnrefused'))
    return newError(ErrorCode.NetworkDns, 'connection refused').wrap(err)
  if (sanitized.toLowerCase().includes('enotfound'))
    return newError(ErrorCode.NetworkDns, 'host lookup failed').wrap(err)
  if (sanitized.toLowerCase().includes('etimedout'))
    return newError(ErrorCode.NetworkTimeout, 'connection timed out').wrap(err)

  return newError(ErrorCode.Unknown, sanitized).wrap(err)
}
