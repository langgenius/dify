import { toast } from '@langgenius/dify-ui/toast'

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
