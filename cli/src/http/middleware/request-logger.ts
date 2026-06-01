import type { BeforeRequestHook, BeforeRetryHook } from 'ky'
import type { HttpLogger } from '@/http/types'
import { redactBearer } from '@/http/sanitize'

const START_TIME = Symbol('difyctl-http-start')

type Timed = { [START_TIME]?: number }

export function logBeforeRequest(logger: HttpLogger | undefined): BeforeRequestHook {
  if (logger === undefined)
    return () => undefined
  return ({ request }) => {
    const safeUrl = redactBearer(request.url)
    ;(request as unknown as Timed)[START_TIME] = performance.now()
    logger({ phase: 'request', method: request.method, url: safeUrl })
  }
}

export function logBeforeRetry(logger: HttpLogger | undefined): BeforeRetryHook {
  if (logger === undefined)
    return () => undefined
  return ({ request, retryCount }) => {
    logger({
      phase: 'retry',
      method: request.method,
      url: redactBearer(request.url),
      attempt: retryCount,
    })
  }
}
