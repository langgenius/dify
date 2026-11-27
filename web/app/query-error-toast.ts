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

/** The message for a failed request: translated by its code, or the server's own. */
function requestErrorMessage(
  error: ORPCError<string, unknown>,
  t: RequestErrorTranslator | undefined,
  fallback?: string,
) {
  if (t) return resolveRequestErrorMessage(error, { t, fallback })
  const serverMessage = getHttpErrorBodyMessage(error.data)
  if (serverMessage) return { message: serverMessage, source: 'server' as const }
  return { message: fallback ?? actionFailedMessage(), source: 'generic' as const }
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

/**
 * Reports a failed first load and a failed background refetch alike, so no read fails without
 * feedback. A query whose owner renders its own error state sets `meta.errorToast: false`.
 */
function reportQueryError(error: unknown, query: AnyQuery) {
  if (query.meta?.errorToast === false) return
  const requestError = getReportableRequestError(error)
  if (!requestError) return
  const errorMessage = query.meta?.errorMessage
  // A read nothing explains stays with its owner's error state, and with a caller that rethrows
  // it, such as a mutation awaiting this query, which reports it with its own text.
  if (!errorMessage && !isExplainedRequestError(requestError)) return
  // Once reported, a caller that rethrows the error must not report it again.
  markErrorHandled(requestError)
  withRequestErrorTranslator((t) => {
    const { message } = errorMessage
      ? { message: errorMessage }
      : requestErrorMessage(requestError, t)

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

/**
 * Reports a failed request that a user action awaits outside TanStack Query, the same way the
 * mutation cache would. Prefer running the action through a mutation.
 */
export function toastRequestError(error: unknown, message?: string) {
  const requestError = getReportableRequestError(error)
  if (!requestError) return
  // A nested mutation or a caller that rethrows the same error must not report it again.
  markErrorHandled(requestError)
  if (message) return toast.error(message)
  withRequestErrorTranslator((t) => toast.error(requestErrorMessage(requestError, t).message))
}

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

/**
 * Reports any failure of a user action that no mutation reports, such as a lookup before an
 * install: request errors as `toastRequestError` does, and a network failure or timeout with
 * a generic message for its kind. A failure that was already reported, a sign-in failure and a
 * cancellation stay silent.
 */
export function toastActionError(error: unknown) {
  if (isAbortError(error) || isErrorHandled(error)) return
  if (error instanceof ORPCError && typeof error.status === 'number') {
    // A client without the console transport, such as the marketplace one, keeps a response body
    // that is not an oRPC error under `data.body`.
    const data = error.data as { body?: unknown } | undefined
    toastRequestError(error, getHttpErrorBodyMessage(data?.body))
    return
  }
  markErrorHandled(error)
  withRequestErrorTranslator((t) =>
    toast.error(t ? describeRequestError(error, { t }) : actionFailedMessage()),
  )
}

/**
 * Every failed write is a separate user action. A mutation sets `meta.errorMessage` to replace
 * the server's message, or `meta.errorToast: false` when its owner presents the failure itself.
 */
function reportMutationError(error: unknown, mutation: AnyMutation) {
  if (mutation.meta?.errorToast === false) return
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
