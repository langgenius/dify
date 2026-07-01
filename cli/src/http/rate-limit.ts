import { backoffDelay } from './retry.js'

// Stateless handling for the server's 429s: react when one arrives, never predict or store limits.
// The server is self-describing via the unified ErrorBody `code`:
//   "too_many_requests" → throttle, waiting helps (retryable)
//   "rate_limit_error"  → quota, waiting within the window does not (not retryable)
// anything else / unparsable → conservative: not retryable.

export type RateLimitDecision = {
  readonly retryable: boolean
  // The advised wait, from the Retry-After header (only meaningful for a retryable throttle).
  readonly retryAfterMs?: number
}

// The longest server-advised wait we'll honor by retrying. If Retry-After is larger, the 429
// branch surfaces immediately instead of parking the process for minutes (better to let the
// caller decide than to sleep through several capped retries that will just 429 again).
export const MAX_HONORED_WAIT_MS = 60_000

export const RATE_LIMIT_MAX_ATTEMPTS = 3

function bodyCode(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const code = (parsed as Record<string, unknown>).code
      return typeof code === 'string' ? code : undefined
    }
  }
  catch {
    // not JSON
  }
  return undefined
}

// Read a 429 response into a retry decision. Reads the ErrorBody `code` for retryability and
// the Retry-After header for the wait; both off a clone so the body stays consumable downstream.
export async function classifyRateLimit(response: Response): Promise<RateLimitDecision> {
  let raw = ''
  try {
    raw = await response.clone().text()
  }
  catch {
    // ignore read errors; raw stays ''
  }
  const retryable = bodyCode(raw) === 'too_many_requests'
  return { retryable, retryAfterMs: retryable ? parseRetryAfterMs(response.headers) : undefined }
}

// Parse the Retry-After header to ms: integer seconds, or an HTTP-date relative to `now`
// (injectable for deterministic tests). The unified ErrorBody carries no wait field of its own.
export function parseRetryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const header = headers.get('retry-after')
  if (header === null) {
    return undefined
  }
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now)
  }
  return undefined
}

// Equal-jitter backoff around the exponential base: half fixed + half random. Avoids both the
// thundering-herd of a fixed delay and the near-zero spikes of full jitter.
function jitter(baseMs: number, rng: () => number): number {
  if (baseMs <= 0) {
    return 0
  }
  const half = baseMs / 2
  return Math.round(half + rng() * half)
}

// How long to wait before the next 429 retry: a known server wait takes precedence (the caller
// has already declined to retry waits beyond MAX_HONORED_WAIT_MS), otherwise jittered exponential
// backoff for sources that advise none (e.g. app concurrency).
export function rateLimitDelayMs(
  decision: Pick<RateLimitDecision, 'retryAfterMs'>,
  attempt: number,
  opts: { rng?: () => number } = {},
): number {
  if (decision.retryAfterMs !== undefined) {
    return decision.retryAfterMs
  }
  return jitter(backoffDelay(attempt), opts.rng ?? Math.random)
}
