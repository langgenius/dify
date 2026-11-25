import type { Mutation, Query } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import { MutationCache, QueryCache } from '@tanstack/react-query'
import { getI18n } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isErrorHandled, isSilentRequestError, markErrorHandled } from '@/service/handled-error'
import { getHttpErrorBodyMessage } from '@/service/http-error'

const DEDUPE_WINDOW_MS = 10000

type AnyQuery = Query<unknown, unknown, unknown>
type AnyMutation = Mutation<unknown, unknown, unknown, unknown>

/**
 * A failed HTTP request the cache should report. Sign-in failures (401), errors the request
 * layer already presented, client exceptions and aborts are left to their owners.
 */
function getReportableRequestError(error: unknown) {
  if (!(error instanceof ORPCError) || typeof error.status !== 'number') return undefined
  if (error.status < 400 || error.status === 401 || isErrorHandled(error)) return undefined
  return error
}

// Reporting runs outside React too, before i18n may be ready; the toast must never throw.
const actionFailedMessage = () =>
  getI18n()?.t(($) => $['api.actionFailed'], { ns: 'common' }) || 'Action failed'

// A polling query fails once per interval, so a message is shown once per window per query.
const queryToasts = new Map<string, Map<string, number>>()

function clearQueryErrorToasts(query: AnyQuery) {
  queryToasts.delete(query.queryHash)
}

// Retention stays bounded by the queries that failed within the last window.
function pruneExpiredQueryToasts(now: number) {
  for (const [queryHash, messages] of queryToasts) {
    for (const [message, expiresAt] of messages) if (now >= expiresAt) messages.delete(message)
    if (messages.size === 0) queryToasts.delete(queryHash)
  }
}

/**
 * Reports a failed first load and a failed background refetch alike, so no read fails without
 * feedback. A query whose owner renders its own error state sets `meta.errorToast: false`.
 */
function reportQueryError(error: unknown, query: AnyQuery) {
  if (query.meta?.errorToast === false) return
  if (isSilentRequestError(error)) return
  const requestError = getReportableRequestError(error)
  if (!requestError) return
  const message = query.meta?.errorMessage ?? getHttpErrorBodyMessage(requestError.data)
  if (!message) return

  const now = Date.now()
  pruneExpiredQueryToasts(now)
  const messages = queryToasts.get(query.queryHash) ?? new Map<string, number>()
  queryToasts.set(query.queryHash, messages)
  // Once reported, a caller that rethrows the error, such as a mutation awaiting this query,
  // must not report it again.
  markErrorHandled(requestError)
  const expiresAt = messages.get(message)
  if (expiresAt !== undefined && now < expiresAt) return
  messages.set(message, now + DEDUPE_WINDOW_MS)
  toast.error(message)
}

/**
 * Reports a failed request that a user action awaits outside TanStack Query, the same way the
 * mutation cache would. Prefer running the action through a mutation.
 */
export function toastRequestError(error: unknown, message?: string) {
  const requestError = getReportableRequestError(error)
  if (!requestError) return
  toast.error(message ?? getHttpErrorBodyMessage(requestError.data) ?? actionFailedMessage())
  // A nested mutation or a caller that rethrows the same error must not report it again.
  markErrorHandled(requestError)
}

/**
 * Every failed write is a separate user action. A mutation sets `meta.errorMessage` to replace
 * the server's message, or `meta.errorToast: false` when its owner presents the failure itself.
 */
function reportMutationError(error: unknown, mutation: AnyMutation) {
  if (mutation.meta?.errorToast === false || isSilentRequestError(error)) return
  toastRequestError(error, mutation.meta?.errorMessage)
}

/** The caches that report request errors; tests opt in to mirror the app's QueryClient. */
export function createErrorToastCaches() {
  return {
    queryCache: (() => {
      const queryCache = new QueryCache({
        onError: reportQueryError,
        onSuccess: (_data, query) => clearQueryErrorToasts(query),
      })
      queryCache.subscribe((event) => {
        if (event.type === 'removed') clearQueryErrorToasts(event.query)
      })
      return queryCache
    })(),
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) =>
        reportMutationError(error, mutation),
    }),
  }
}
