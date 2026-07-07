import type { Hook, HttpLogger } from './types.js'
import { BaseError } from '@/errors/base'
import { classifyTransportError } from './error-mapper.js'
import { redactBearer } from './sanitize.js'

export const HTTP_START_SYM = Symbol('difyctl-http-start')

export function setBearer(token: string): Hook {
  return ({ request }) => {
    if (!request.headers.has('authorization'))
      request.headers.set('authorization', `Bearer ${token}`)
  }
}

export function setUserAgent(ua: string): Hook {
  return ({ request }) => {
    if (!request.headers.has('user-agent'))
      request.headers.set('user-agent', ua)
  }
}

export function logRequest(logger: HttpLogger): Hook {
  return ({ request, meta }) => {
    meta.set(HTTP_START_SYM, performance.now())
    logger({
      phase: 'request',
      method: request.method,
      url: redactBearer(request.url),
    })
  }
}

export function logResponse(logger: HttpLogger): Hook {
  return ({ request, response, meta }) => {
    if (response === undefined)
      return
    const start = meta.get(HTTP_START_SYM)
    const durationMs = typeof start === 'number' ? performance.now() - start : undefined
    logger({
      phase: 'response',
      method: request.method,
      url: redactBearer(request.url),
      status: response.status,
      durationMs,
    })
  }
}

export const classifyTransport: Hook = (ctx) => {
  if (ctx.error === undefined)
    return
  if (ctx.error instanceof BaseError)
    return
  ctx.error = classifyTransportError(ctx.error)
}
