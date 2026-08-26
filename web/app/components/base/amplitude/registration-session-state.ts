export const REGISTRATION_SUCCESS_STORAGE_KEY = 'pending_registration_success_event'
export const OAUTH_REGISTRATION_GA_SENT_KEY = 'oauth_registration_ga_sent'

export const REGISTRATION_METHODS = ['email', 'email_code', 'oauth', 'workspace_invite'] as const

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

export const VOLATILE_INTENT_TTL_MS = 30 * 60 * 1000

let volatileIntent: RegistrationIntent | null = null
let volatileIntentExpirationTimer: ReturnType<typeof setTimeout> | null = null

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

export const clearVolatileRegistrationIntent = () => {
  if (volatileIntentExpirationTimer !== null) {
    clearTimeout(volatileIntentExpirationTimer)
    volatileIntentExpirationTimer = null
  }
  volatileIntent = null
}

export const replaceVolatileRegistrationIntent = (intent: RegistrationIntent) => {
  clearVolatileRegistrationIntent()
  volatileIntent = intent
  volatileIntentExpirationTimer = setTimeout(() => {
    volatileIntent = null
    volatileIntentExpirationTimer = null
  }, VOLATILE_INTENT_TTL_MS)
}

export const getVolatileRegistrationIntent = () => volatileIntent

export const discardRegistrationSessionState = () => {
  clearVolatileRegistrationIntent()
  removeStoredRegistrationMarker()
  clearOAuthRegistrationGAGuard()
}
