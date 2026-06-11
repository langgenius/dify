/**
 * Retry helper for E2E tests running against a staging server.
 *
 * Staging environments can be flaky — occasional 5xx errors or slow cold
 * starts are expected.  Use `withRetry` to wrap assertions that may fail
 * transiently without masking real failures.
 */

const DEFAULT_ATTEMPTS = 3
const DEFAULT_DELAY_MS = 1000

export type RetryOptions = {
  /** Total number of attempts (first try + retries). Default: 3 */
  attempts?: number
  /** Delay between retries in ms. Default: 1000 */
  delayMs?: number
  /** Optional predicate — only retry when this returns true for the error. */
  shouldRetry?: (err: unknown) => boolean
}

/**
 * Execute `fn()` and retry on failure.
 *
 * @example
 * const result = await withRetry(() => run(['get', 'app', '-o', 'json']))
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const total = opts.attempts ?? DEFAULT_ATTEMPTS
  const delay = opts.delayMs ?? DEFAULT_DELAY_MS
  const shouldRetry = opts.shouldRetry ?? (() => true)

  let lastErr: unknown
  for (let attempt = 1; attempt <= total; attempt++) {
    try {
      return await fn()
    }
    catch (err) {
      lastErr = err
      if (attempt === total || !shouldRetry(err))
        break

      console.warn(`[E2E retry] attempt ${attempt}/${total} failed — retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastErr
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
