import type { Mutation, Query } from '@tanstack/react-query'
import type { RequestErrorTranslator } from '@/service/request-error-message'
import { ORPCError } from '@orpc/client'
import { MutationCache, QueryCache } from '@tanstack/react-query'
import { getI18n } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isErrorHandled, markErrorHandled } from '@/service/handled-error'
import { getHttpErrorBodyMessage } from '@/service/http-error'
import {
  describeRequestError,
  isExplainedRequestError,
  resolveRequestErrorMessage,
} from '@/service/request-error-message'

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

/**
 * Runs `report` with the request error translations, loading them first when no component has
 * yet. Without i18n, such as before it starts, it gets none and the caller keeps its own text.
 */
function withRequestErrorTranslator(report: (t: RequestErrorTranslator | undefined) => void) {
  const i18n = getI18n()
  if (!i18n) return report(undefined)
  // A failed resource load still resolves `loadNamespaces` and can mark the namespace loaded, so
  // the bundle itself decides whether translations exist.
  const isAvailable = () =>
    !!i18n.getResourceBundle(i18n.resolvedLanguage ?? i18n.language, 'requestErrors')
  const translate = () => report(isAvailable() ? i18n.getFixedT(null, 'requestErrors') : undefined)
  if (isAvailable()) return translate()
  i18n.loadNamespaces('requestErrors').then(translate, () => report(undefined))
}

/**
 * The message for a failed request: translated by its code. Without translations it is the
 * caller's text, then the server's own.
 */
function requestErrorMessage(
  error: ORPCError<string, unknown>,
  t: RequestErrorTranslator | undefined,
  fallback?: string,
) {
  if (t) return resolveRequestErrorMessage(error, { t, fallback })
  if (fallback) return { message: fallback, source: 'fallback' as const }
  const serverMessage = getHttpErrorBodyMessage(error.data)
  if (serverMessage) return { message: serverMessage, source: 'server' as const }
  return { message: actionFailedMessage(), source: 'generic' as const }
}

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

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

/**
 * A request that got no response: the network failed (`fetch` rejects with a `TypeError`) or it
 * timed out. A cancellation is not one.
 */
function isTransportFailure(error: unknown): error is Error {
  if (isAbortError(error) || isErrorHandled(error)) return false
  if (error instanceof Error && error.name === 'TimeoutError') return true
  return error instanceof TypeError
}

/**
 * Waits until React has rendered the observers' update: the cache reports a failure before it
 * notifies them, and their notification is itself scheduled on a macrotask.
 */
function afterObserversRender(callback: () => void) {
  setTimeout(() => setTimeout(callback, 0), 0)
}

/**
 * Reports a failed first load, a failed next page and a failed background refetch, so no read
 * fails without feedback. Each report waits for the render that follows the failure: an owner
 * that renders the error claims it through `useOwnedQueryError` (a first load) or
 * `useOwnedNextPageError` (a next page), and a claimed error is not toasted. A refetch keeps
 * showing cached data, so nothing claims it and it toasts. `meta.errorMessage` is the query's
 * text for codes the catalog does not know; a query whose owner also presents refetch failures,
 * or a deliberately silent read, sets `meta.errorToast: false`.
 */
function reportQueryError(error: unknown, query: AnyQuery) {
  if (query.meta?.errorToast === false) return
  const requestError = getReportableRequestError(error)
  const transportFailure = !requestError && isTransportFailure(error) ? error : undefined
  const reported = requestError ?? transportFailure
  if (!reported) return
  const errorMessage = query.meta?.errorMessage
  // A read nothing explains stays with its owner's error state, and with a caller that rethrows
  // it, such as a mutation awaiting this query, which reports it with its own text. A network
  // failure or a timeout always explains itself with text for its kind.
  if (requestError && !errorMessage && !isExplainedRequestError(requestError)) return
  const report = () => {
    // A claimed error is on screen; a caller that rethrew it has already reported it.
    if (isErrorHandled(reported)) return
    // Once reported, a caller that rethrows the error must not report it again.
    markErrorHandled(reported)
    withRequestErrorTranslator((t) => {
      const message = requestError
        ? requestErrorMessage(requestError, t, errorMessage).message
        : t
          ? describeRequestError(reported, { t })
          : actionFailedMessage()

      const now = Date.now()
      pruneExpiredQueryToasts(now)
      const messages = queryToasts.get(query.queryHash) ?? new Map<string, number>()
      queryToasts.set(query.queryHash, messages)
      const expiresAt = messages.get(message)
      if (expiresAt !== undefined && now < expiresAt) return
      messages.set(message, now + DEDUPE_WINDOW_MS)
      toast.error(message)
    })
  }
  afterObserversRender(report)
}

/** Shows a reportable request error's message once; a caller that rethrows it stays silent. */
function toastReportableRequestError(requestError: ORPCError<string, unknown>, fallback?: string) {
  markErrorHandled(requestError)
  withRequestErrorTranslator((t) =>
    toast.error(requestErrorMessage(requestError, t, fallback).message),
  )
}

/**
 * Reports a failure of a user action that no mutation reports, such as a request awaited outside
 * TanStack Query or a lookup before an install, so no action fails silently. A request error shows
 * its translated message, with `fallback` as the caller's text for codes the catalog does not
 * know; a network failure, a timeout or another exception shows generic text for its kind. A
 * failure that was already reported, a sign-in failure and a cancellation stay silent. Prefer
 * running the action through a mutation.
 */
export function reportRequestError(error: unknown, fallback?: string) {
  if (isAbortError(error) || isErrorHandled(error)) return
  if (error instanceof ORPCError && typeof error.status === 'number') {
    const requestError = getReportableRequestError(error)
    if (requestError) toastReportableRequestError(requestError, fallback)
    return
  }
  markErrorHandled(error)
  withRequestErrorTranslator((t) =>
    toast.error(
      t ? describeRequestError(error, { t, fallback }) : (fallback ?? actionFailedMessage()),
    ),
  )
}

/**
 * Every failed write is a separate user action. A mutation sets `meta.errorMessage` as its text
 * for codes the catalog does not know, or `meta.errorToast: false` when its owner presents the
 * failure itself.
 */
function reportMutationError(error: unknown, mutation: AnyMutation) {
  if (mutation.meta?.errorToast === false) return
  const requestError = getReportableRequestError(error)
  if (requestError) toastReportableRequestError(requestError, mutation.meta?.errorMessage)
}

/**
 * The caches that report request errors; tests opt in to mirror the app's QueryClient.
 * `onMutationSuccess` runs when a mutation's request succeeds, before its callbacks.
 */
export function createErrorToastCaches({
  onMutationSuccess,
}: { onMutationSuccess?: (mutation: AnyMutation) => void } = {}) {
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
      onSuccess: (_data, _variables, _onMutateResult, mutation) => onMutationSuccess?.(mutation),
      onError: (error, _variables, _onMutateResult, mutation) =>
        reportMutationError(error, mutation),
    }),
  }
}
