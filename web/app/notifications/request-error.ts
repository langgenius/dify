import { ORPCError } from '@orpc/client'
import { isAppDeletionError } from '@/service/app-deletion'
import { getHttpErrorUrl } from '@/service/http-error'
import { toast } from '.'

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'

// The transport resolves unauthorized responses by redirecting to sign-in, except for sign-in
// requests themselves, whose 401 explains the failed attempt.
const isLoginRequest = (error: unknown) => /\/login/.test(getHttpErrorUrl(error) ?? '')

// Requests that race an app deletion fail by design.
const isExpectedRequestError = (error: unknown) =>
  isAbortError(error) ||
  (error instanceof ORPCError &&
    ((error.status === 401 && !isLoginRequest(error)) || isAppDeletionError(error)))

/**
 * Show a request failure to the user. The request layer never notifies on its own, so callers
 * that handle a failure imperatively decide here whether it deserves a toast.
 *
 * `title` names the failed action; the server message then explains it underneath. Without a
 * title only failures whose response body carries a message are shown.
 */
// Only a message from the response body explains a failure; the status text an empty body falls
// back to (such as `HTTP 500`) does not.
const getServerMessage = (error: unknown) => {
  if (!(error instanceof ORPCError)) return undefined
  const data: unknown = error.data
  if (typeof data !== 'object' || data === null) return undefined
  const { message, error: legacyMessage } = data as { message?: unknown; error?: unknown }
  return [message, legacyMessage].find(
    (value): value is string => typeof value === 'string' && !!value.trim(),
  )
}

export function toastRequestError(error: unknown, title?: string) {
  if (isExpectedRequestError(error)) return
  const serverMessage = getServerMessage(error)
  const text = title ?? serverMessage
  if (!text) return
  const description = title && serverMessage !== title ? serverMessage : undefined
  // Identical failures, such as several queries hitting the same outage, share one visible toast.
  toast.error(text, {
    id: `request-error:${text}${description ? `:${description}` : ''}`,
    ...(description && { description }),
  })
}

/** Toast a request failure while keeping it rejected for callers that must still stop on it. */
export async function withRequestErrorToast<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error) {
    toastRequestError(error)
    throw error
  }
}

// Streams report cancellation as a message, for instance when one is stopped or its page is left.
const isStreamCancellation = (message: string) =>
  message === 'AbortError' ||
  message.startsWith('AbortError:') ||
  message.includes('TypeError: Cannot assign to read only property')

/**
 * Show a stream failure from an `ssePost` / `sseGet` `onError` callback. Pages with their own
 * toast host pass `notify` to show it there.
 */
export function toastStreamError(
  message: string,
  notify: (message: string) => void = (text) => toast.error(text, { id: `request-error:${text}` }),
) {
  if (typeof message !== 'string' || !message || isStreamCancellation(message)) return
  notify(message)
}
