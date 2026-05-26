import type { BaseError } from './base.js'

export type ErrorEnvelope = {
  error: {
    code: string
    message: string
    hint?: string
    http_status?: number
    method?: string
    url?: string
  }
}

export function toEnvelope(err: BaseError): ErrorEnvelope {
  const payload: ErrorEnvelope['error'] = {
    code: err.code,
    message: err.message,
  }
  if (err.hint !== undefined)
    payload.hint = err.hint
  if (err.httpStatus !== undefined)
    payload.http_status = err.httpStatus
  if (err.method !== undefined)
    payload.method = err.method
  if (err.url !== undefined)
    payload.url = err.url
  return { error: payload }
}

export function renderEnvelope(err: BaseError): string {
  return JSON.stringify(toEnvelope(err))
}
