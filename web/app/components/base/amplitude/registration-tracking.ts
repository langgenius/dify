import type { AnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { getAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { getIsAmplitudeInitialized } from './init'
import { trackEvent } from './utils'

export const REGISTRATION_SUCCESS_STORAGE_KEY = 'pending_registration_success_event'

const REGISTRATION_MARKER_VERSION = 2
const REGISTRATION_MARKER_TTL_MS = 24 * 60 * 60 * 1000
const VOLATILE_INTENT_TTL_MS = 30 * 60 * 1000
const SUCCESSFUL_TRACK_RESULT_MIN = 200
const SUCCESSFUL_TRACK_RESULT_MAX = 299

const REGISTRATION_EVENT_NAMES = [
  'user_registration_success',
  'user_registration_success_with_utm',
] as const

const REGISTRATION_METHODS = ['email', 'email_code', 'oauth', 'workspace_invite'] as const

const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'slug',
] as const

export type RegistrationEventName = (typeof REGISTRATION_EVENT_NAMES)[number]
export type RegistrationMethod = (typeof REGISTRATION_METHODS)[number]
export type RegistrationAttribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>

type RegistrationIntent = {
  registrationId: string
  occurredAt: number
  method: RegistrationMethod
  attribution: RegistrationAttribution
}

type PendingRegistrationSuccessEvent = RegistrationIntent & {
  version: typeof REGISTRATION_MARKER_VERSION
  expiresAt: number
  eventName: RegistrationEventName
}

let volatileIntent: RegistrationIntent | null = null
let registrationSnapshot = 0
let activeFlush: Promise<void> | null = null
const registrationListeners = new Set<() => void>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isRegistrationMethod = (value: unknown): value is RegistrationMethod =>
  typeof value === 'string' && REGISTRATION_METHODS.includes(value as RegistrationMethod)

const isRegistrationEventName = (value: unknown): value is RegistrationEventName =>
  typeof value === 'string' && REGISTRATION_EVENT_NAMES.includes(value as RegistrationEventName)

const notifyRegistrationMarkerStored = () => {
  registrationSnapshot += 1
  registrationListeners.forEach((listener) => listener())
}

const createRegistrationId = () => {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

const getSessionStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export const normalizeRegistrationAttribution = (
  value?: Record<string, unknown> | null,
): RegistrationAttribution | null => {
  if (!value) return null

  const attribution: RegistrationAttribution = {}
  ATTRIBUTION_KEYS.forEach((key) => {
    const item = value[key]
    if (typeof item !== 'string') return

    const normalized = item.trim()
    if (normalized) attribution[key] = normalized
  })

  return Object.keys(attribution).length ? attribution : null
}

const createRegistrationIntent = (
  method: RegistrationMethod,
  utmInfo?: Record<string, unknown> | null,
): RegistrationIntent => ({
  registrationId: createRegistrationId(),
  occurredAt: Date.now(),
  method,
  attribution: normalizeRegistrationAttribution(utmInfo) ?? {},
})

const storeRegistrationIntent = (intent: RegistrationIntent) => {
  const storage = getSessionStorage()
  if (!storage) return false

  const pending: PendingRegistrationSuccessEvent = {
    ...intent,
    version: REGISTRATION_MARKER_VERSION,
    expiresAt: intent.occurredAt + REGISTRATION_MARKER_TTL_MS,
    eventName: Object.keys(intent.attribution).length
      ? 'user_registration_success_with_utm'
      : 'user_registration_success',
  }

  try {
    storage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, JSON.stringify(pending))
    notifyRegistrationMarkerStored()
    return true
  } catch {
    return false
  }
}

export const rememberRegistrationSuccess = ({
  method,
  utmInfo,
}: {
  method: RegistrationMethod
  utmInfo?: Record<string, unknown> | null
}) => {
  const consent = getAnalyticsConsent()
  if (consent === 'denied' || consent === 'disabled') {
    volatileIntent = null
    return false
  }

  const intent = createRegistrationIntent(method, utmInfo)
  if (consent === 'unknown') {
    if (method === 'oauth') return false
    volatileIntent = intent
    return true
  }

  return storeRegistrationIntent(intent)
}

export const coordinateRegistrationConsent = (consent: AnalyticsConsent) => {
  if (consent === 'denied' || consent === 'disabled') {
    volatileIntent = null
    const storage = getSessionStorage()
    try {
      storage?.removeItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    } catch {}
    return
  }
  if (consent !== 'granted' || !volatileIntent) return

  const intent = volatileIntent
  const age = Date.now() - intent.occurredAt
  if (age < 0 || age > VOLATILE_INTENT_TTL_MS) {
    volatileIntent = null
    return
  }

  if (storeRegistrationIntent(intent)) volatileIntent = null
}

export const subscribeRegistrationSuccess = (listener: () => void) => {
  registrationListeners.add(listener)
  return () => registrationListeners.delete(listener)
}

export const getRegistrationSuccessSnapshot = () => registrationSnapshot

const isRegistrationAttribution = (value: unknown): value is RegistrationAttribution => {
  if (!isRecord(value)) return false

  return Object.entries(value).every(
    ([key, item]) =>
      ATTRIBUTION_KEYS.includes(key as (typeof ATTRIBUTION_KEYS)[number]) &&
      typeof item === 'string' &&
      Boolean(item.trim()),
  )
}

const parsePendingRegistration = (raw: string): PendingRegistrationSuccessEvent | null => {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return null
    if (value.version !== REGISTRATION_MARKER_VERSION) return null
    if (typeof value.registrationId !== 'string' || !value.registrationId) return null
    if (typeof value.occurredAt !== 'number' || !Number.isFinite(value.occurredAt)) return null
    if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return null
    if (value.expiresAt !== value.occurredAt + REGISTRATION_MARKER_TTL_MS) return null
    if (!isRegistrationEventName(value.eventName)) return null
    if (!isRegistrationMethod(value.method)) return null
    if (!isRegistrationAttribution(value.attribution)) return null

    const hasAttribution = Object.keys(value.attribution).length > 0
    if (hasAttribution !== (value.eventName === 'user_registration_success_with_utm')) return null

    return value as PendingRegistrationSuccessEvent
  } catch {
    return null
  }
}

const removeStoredMarker = (storage: Storage) => {
  try {
    storage.removeItem(REGISTRATION_SUCCESS_STORAGE_KEY)
  } catch {}
}

const runRegistrationFlush = async () => {
  const consent = getAnalyticsConsent()
  if (consent === 'unknown') return

  const storage = getSessionStorage()
  if (!storage) return

  if (consent === 'denied' || consent === 'disabled') {
    removeStoredMarker(storage)
    return
  }
  if (!getIsAmplitudeInitialized()) return

  while (true) {
    let raw: string | null
    try {
      raw = storage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    } catch {
      return
    }
    if (!raw) return

    const pending = parsePendingRegistration(raw)
    if (!pending || pending.expiresAt <= Date.now()) {
      removeStoredMarker(storage)
      return
    }

    let trackResult: ReturnType<typeof trackEvent>
    try {
      trackResult = trackEvent(
        pending.eventName,
        {
          method: pending.method,
          ...pending.attribution,
          registration_id: pending.registrationId,
          event_version: REGISTRATION_MARKER_VERSION,
          tracking_contract_version: 'consent_wait_v2',
        },
        {
          insert_id: pending.registrationId,
          time: pending.occurredAt,
        },
      )
    } catch {
      return
    }
    if (!trackResult) return

    let result: { code?: unknown }
    try {
      result = await trackResult.promise
    } catch {
      return
    }

    if (
      typeof result.code !== 'number' ||
      result.code < SUCCESSFUL_TRACK_RESULT_MIN ||
      result.code > SUCCESSFUL_TRACK_RESULT_MAX
    )
      return

    let currentRaw: string | null
    try {
      currentRaw = storage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    } catch {
      return
    }
    if (currentRaw !== raw) continue

    removeStoredMarker(storage)
    return
  }
}

export const flushRegistrationSuccess = () => {
  if (activeFlush) return activeFlush

  activeFlush = runRegistrationFlush().finally(() => {
    activeFlush = null
  })
  return activeFlush
}
