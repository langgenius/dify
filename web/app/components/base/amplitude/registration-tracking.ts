import { trackEvent } from './utils'

/**
 * Storage key for a registration success event that is waiting to be sent to
 * Amplitude until a user ID has been attached.
 */
export const REGISTRATION_SUCCESS_STORAGE_KEY = 'pending_registration_success_event'

type RegistrationMethod = 'email' | 'oauth'

type PendingRegistrationSuccessEvent = {
  eventName: string
  properties: Record<string, unknown>
}

const getSessionStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Remember a registration success event so it can be sent to Amplitude *after* the
 * user ID is attached (see `flushRegistrationSuccess`).
 *
 * Amplitude attributes events to whatever identity is active when `track` runs. At
 * registration time the client does not yet know the user ID, so firing the event
 * immediately records it under an anonymous profile. We persist the event here and
 * replay it once `setUserId` runs in the bootstrap effects after the redirect.
 */
export const rememberRegistrationSuccess = ({
  method,
  utmInfo,
}: {
  method: RegistrationMethod
  utmInfo?: Record<string, unknown> | null
}) => {
  const storage = getSessionStorage()
  if (!storage) return

  const pending: PendingRegistrationSuccessEvent = {
    eventName: utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success',
    properties: { method, ...utmInfo },
  }

  try {
    storage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, JSON.stringify(pending))
  } catch {}
}

/**
 * Send a previously remembered registration success event to Amplitude.
 *
 * MUST be called after `setUserId` so the event lands on the identified user profile.
 * No-op when nothing is pending. The pending entry is removed before tracking so the
 * event fires at most once even if this runs multiple times.
 */
export const flushRegistrationSuccess = () => {
  const storage = getSessionStorage()
  if (!storage) return

  let raw: string | null = null
  try {
    raw = storage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
  } catch {
    return
  }

  if (!raw) return

  try {
    storage.removeItem(REGISTRATION_SUCCESS_STORAGE_KEY)
  } catch {}

  try {
    const pending = JSON.parse(raw) as PendingRegistrationSuccessEvent
    if (pending?.eventName) trackEvent(pending.eventName, pending.properties)
  } catch {}
}
