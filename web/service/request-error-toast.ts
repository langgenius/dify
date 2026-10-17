import type { HttpError } from './http-error'
import { toast } from '@/app/notifications'
import { shouldSuppressAppDeletionErrorToast } from './app-deletion'

const DEDUPE_WINDOW_MS = 10000

type RequestIdentity = Pick<Request, 'method' | 'url'>
type ErrorNotification = {
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const notifications = new Map<string, Map<string, ErrorNotification>>()
const requestKey = (request: RequestIdentity) => JSON.stringify([request.method, request.url])

export function clearRequestErrorToasts(request: RequestIdentity) {
  const key = requestKey(request)
  const messages = notifications.get(key)
  if (!messages) return
  for (const notification of messages.values()) clearTimeout(notification.timer)
  notifications.delete(key)
}

export function notifyRequestError(request: RequestIdentity, message: string) {
  // Writes can be separate user actions even when their errors are identical.
  if (request.method !== 'GET') {
    toast.error(message)
    return
  }

  const key = requestKey(request)
  const messages = notifications.get(key) ?? new Map<string, ErrorNotification>()
  notifications.set(key, messages)
  const previous = messages.get(message)
  const now = Date.now()
  if (previous && now < previous.expiresAt) return
  if (previous) clearTimeout(previous.timer)

  // Only a displayed toast starts the window; suppressed retries do not extend it.
  const timer = setTimeout(() => {
    messages.delete(message)
    if (messages.size === 0) notifications.delete(key)
  }, DEDUPE_WINDOW_MS)
  messages.set(message, { expiresAt: now + DEDUPE_WINDOW_MS, timer })
  toast.error(message)
}

/**
 * Shows the backend error toast for a failed request and handles the `already_setup` redirect.
 * Shared by the legacy fetch helpers and the console oRPC link so both report errors alike.
 */
export function reportHttpError(
  request: Pick<Request, 'method' | 'url'>,
  error: HttpError,
  silent?: boolean,
) {
  const errorData = error.data
  const shouldNotifyError =
    error.status >= 400 &&
    error.status !== 401 &&
    errorData &&
    !silent &&
    !shouldSuppressAppDeletionErrorToast(request.url, error.status)

  const errorMessage = [errorData?.message, errorData?.error].find(
    (value): value is string => typeof value === 'string' && !!value.trim(),
  )
  if (shouldNotifyError && errorMessage) notifyRequestError(request, errorMessage)

  if (error.status === 403 && errorData?.code === 'already_setup')
    globalThis.location.href = `${globalThis.location.origin}/signin`
}
