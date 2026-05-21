import type { FetchContext } from './types.js'

export const RETRY_METHODS = ['GET', 'PUT', 'DELETE'] as const
export const RETRY_STATUS_CODES = [408, 413, 429, 500, 502, 503, 504] as const

const RETRY_METHODS_SET: ReadonlySet<string> = new Set(RETRY_METHODS)
const RETRY_STATUS_SET: ReadonlySet<number> = new Set(RETRY_STATUS_CODES)

export function shouldRetry(target: Response | unknown, ctx: FetchContext): boolean {
  if (!RETRY_METHODS_SET.has(ctx.options.method))
    return false
  if (target instanceof Response)
    return RETRY_STATUS_SET.has(target.status)
  // Transport error: retry if method is in allowlist, except for user-initiated aborts.
  if (target instanceof Error && target.name === 'AbortError')
    return false
  return true
}

// Exponential backoff matching ky's default (0.3s, 0.6s, 1.2s, ... capped).
const BACKOFF_BASE_MS = 300
const BACKOFF_CAP_MS = 30_000

export function backoffDelay(attempt: number): number {
  if (attempt <= 0)
    return 0
  const exp = BACKOFF_BASE_MS * 2 ** (attempt - 1)
  return Math.min(exp, BACKOFF_CAP_MS)
}
