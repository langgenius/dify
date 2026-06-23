import type { FetchContext } from './types.js'

export const RETRY_METHODS = ['GET', 'PUT', 'DELETE'] as const
// 429 is intentionally absent — it has a dedicated branch in execute(). shouldRetry covers
// transport errors / 408 / 413 / 5xx only.
export const RETRY_STATUS_CODES = [408, 413, 500, 502, 503, 504] as const

const RETRY_METHODS_SET: ReadonlySet<string> = new Set(RETRY_METHODS)
const RETRY_STATUS_SET: ReadonlySet<number> = new Set(RETRY_STATUS_CODES)

// GET/PUT/DELETE are idempotent — safe to auto-retry. The 429 branch reuses this to decide which
// methods may wait-and-retry a throttle without risking a double-run.
export function isIdempotentRetryMethod(method: string): boolean {
  return RETRY_METHODS_SET.has(method)
}

export function shouldRetry(target: Response | unknown, ctx: FetchContext): boolean {
  if (!RETRY_METHODS_SET.has(ctx.options.method))
    return false
  if (target instanceof Response)
    return RETRY_STATUS_SET.has(target.status)
  // Any other transport error on a retryable method retries. User aborts are filtered
  // out earlier in dispatch (before this hook ever runs), so they never reach here.
  return true
}

// Exponential backoff: 300ms base, doubling each attempt, capped at 30s
// (300ms, 600ms, 1.2s, ...).
const BACKOFF_BASE_MS = 300
const BACKOFF_CAP_MS = 30_000

export function backoffDelay(attempt: number): number {
  if (attempt <= 0)
    return 0
  const exp = BACKOFF_BASE_MS * 2 ** (attempt - 1)
  return Math.min(exp, BACKOFF_CAP_MS)
}
