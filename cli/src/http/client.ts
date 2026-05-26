import type { AfterResponseHook, BeforeErrorHook, KyInstance } from 'ky'
import type { HttpFactoryOptions, HttpLogger } from './types.js'
import ky from 'ky'
import { BaseError } from '../errors/base.js'
import { userAgent as defaultUserAgent } from '../version/info.js'
import { classifyResponse, classifyTransportError } from './error-mapper.js'
import { applyBearer } from './middleware/auth.js'
import { logBeforeRequest, logBeforeRetry } from './middleware/request-logger.js'
import { applyUserAgent } from './middleware/user-agent.js'
import { redactBearer } from './sanitize.js'

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_RETRY_ATTEMPTS = 3

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function logAndClassify(logger: HttpLogger | undefined): AfterResponseHook {
  return async ({ request, response, options }) => {
    if (logger !== undefined) {
      logger({
        phase: 'response',
        method: request.method,
        url: redactBearer(request.url),
        status: response.status,
      })
    }
    if (!response.ok && options.context?.skipClassify !== true)
      throw await classifyResponse(request, response)
    return response
  }
}

const mapTransportError: BeforeErrorHook = ({ error }) => {
  if (error instanceof BaseError)
    return error
  return classifyTransportError(error)
}

export function createClient(opts: HttpFactoryOptions): KyInstance {
  const ua = opts.userAgent ?? defaultUserAgent()
  return ky.create({
    prefix: `${trimSlash(opts.host)}/openapi/v1/`,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retry: {
      limit: opts.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS,
      methods: ['get', 'put', 'delete'],
      statusCodes: [408, 413, 429, 500, 502, 503, 504],
    },
    throwHttpErrors: false,
    hooks: {
      beforeRequest: [
        applyUserAgent(ua),
        applyBearer(opts.bearer),
        logBeforeRequest(opts.logger),
      ],
      afterResponse: [logAndClassify(opts.logger)],
      beforeRetry: [logBeforeRetry(opts.logger)],
      beforeError: [mapTransportError],
    },
  })
}
