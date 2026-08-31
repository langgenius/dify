export const REGISTRATION_SUCCESS_STORAGE_KEY = 'pending_registration_success_event'
export const OAUTH_REGISTRATION_GA_SENT_KEY = 'oauth_registration_ga_sent'
export const FLUSH_RETRY_DELAYS_MS = [1000, 4000, 16000] as const

export const REGISTRATION_METHODS = ['email', 'oauth'] as const

export const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'slug',
] as const

export type RegistrationMethod = (typeof REGISTRATION_METHODS)[number]
export type RegistrationAttribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>

export type RegistrationIntent = {
  registrationId: string
  occurredAt: number
  method: RegistrationMethod
  attribution: RegistrationAttribution
}

let registrationDeliveryGeneration = 0
let flushRetryTimer: ReturnType<typeof setTimeout> | null = null
let flushRetryAttempt = 0

export const getRegistrationSessionStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export const removeStoredRegistrationMarker = (storage = getRegistrationSessionStorage()) => {
  try {
    storage?.removeItem(REGISTRATION_SUCCESS_STORAGE_KEY)
  } catch {}
}

export const hasSentOAuthRegistrationGA = () => {
  try {
    return getRegistrationSessionStorage()?.getItem(OAUTH_REGISTRATION_GA_SENT_KEY) === 'true'
  } catch {
    return false
  }
}

export const markOAuthRegistrationGASent = () => {
  try {
    getRegistrationSessionStorage()?.setItem(OAUTH_REGISTRATION_GA_SENT_KEY, 'true')
  } catch {}
}

export const clearOAuthRegistrationGAGuard = () => {
  try {
    getRegistrationSessionStorage()?.removeItem(OAUTH_REGISTRATION_GA_SENT_KEY)
  } catch {}
}

export const getRegistrationDeliveryGeneration = () => registrationDeliveryGeneration

export const clearRegistrationFlushRetry = () => {
  if (flushRetryTimer !== null) {
    clearTimeout(flushRetryTimer)
    flushRetryTimer = null
  }
  flushRetryAttempt = 0
}

export const scheduleRegistrationFlushRetry = (runFlush: () => void) => {
  if (flushRetryAttempt >= FLUSH_RETRY_DELAYS_MS.length) return

  const delay = FLUSH_RETRY_DELAYS_MS[flushRetryAttempt]
  flushRetryAttempt += 1
  const generation = registrationDeliveryGeneration
  if (flushRetryTimer !== null) clearTimeout(flushRetryTimer)

  flushRetryTimer = setTimeout(() => {
    flushRetryTimer = null
    if (generation !== registrationDeliveryGeneration) return
    runFlush()
  }, delay)
}

export const invalidateRegistrationDeliveryState = () => {
  registrationDeliveryGeneration += 1
  clearRegistrationFlushRetry()
  removeStoredRegistrationMarker()
}

export const discardRegistrationSessionState = () => {
  invalidateRegistrationDeliveryState()
  clearOAuthRegistrationGAGuard()
}
