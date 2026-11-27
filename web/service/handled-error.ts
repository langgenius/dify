/**
 * Request errors whose feedback the request layer already owns, such as a sign-in redirect,
 * an app-access dialog or a deleted app, so the query cache must not report them again.
 */
const handledErrors = new WeakSet<object>()

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

/**
 * The defined-error interceptor rebuilds an `ORPCError` with the same `cause`, so the cause
 * carries the mark through that rebuild.
 */
export function markErrorHandled(error: unknown) {
  if (!isObject(error)) return
  handledErrors.add(error)
  if ('cause' in error && isObject(error.cause)) handledErrors.add(error.cause)
}

export function isErrorHandled(error: unknown): boolean {
  if (!isObject(error)) return false
  if (handledErrors.has(error)) return true
  return 'cause' in error && isObject(error.cause) && handledErrors.has(error.cause)
}

/**
 * For an imperative read whose caller presents the failure itself: marks the error, so the query
 * cache's report, which waits for the next render, stays silent, and rethrows it. Unlike
 * `meta.errorToast: false`, it leaves the query's options, and so its later refetches, alone.
 */
export function rethrowHandled(error: unknown): never {
  markErrorHandled(error)
  throw error
}
