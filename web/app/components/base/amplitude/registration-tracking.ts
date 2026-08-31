import type {
  RegistrationAttribution,
  RegistrationIntent,
  RegistrationMethod,
} from './registration-session-state'
import type { AnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { getAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { getIsAmplitudeInitialized } from './init'
import {
  ATTRIBUTION_KEYS,
  clearRegistrationFlushRetry,
  getRegistrationDeliveryGeneration,
  getRegistrationSessionStorage,
  invalidateRegistrationDeliveryState,
  REGISTRATION_METHODS,
  REGISTRATION_SUCCESS_STORAGE_KEY,
  removeStoredRegistrationMarker,
  scheduleRegistrationFlushRetry,
} from './registration-session-state'
import { trackEvent } from './utils'

const REGISTRATION_MARKER_VERSION = 2
const REGISTRATION_MARKER_TTL_MS = 24 * 60 * 60 * 1000
// Browser clocks may be corrected between registration and delivery. Permit a small
// correction, but reject timestamps far enough ahead to corrupt Amplitude ordering.
const REGISTRATION_FUTURE_CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000
const SUCCESSFUL_TRACK_RESULT_MIN = 200
const SUCCESSFUL_TRACK_RESULT_MAX = 299

const REGISTRATION_EVENT_NAMES = [
  'user_registration_success',
  'user_registration_success_with_utm',
] as const

export type RegistrationEventName = (typeof REGISTRATION_EVENT_NAMES)[number]

type PendingRegistrationSuccessEvent = RegistrationIntent & {
  version: typeof REGISTRATION_MARKER_VERSION
  expiresAt: number
  eventName: RegistrationEventName
}

let registrationSnapshot = 0
let activeFlush: { generation: number; promise: Promise<void> } | null = null
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
  const storage = getRegistrationSessionStorage()
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
    clearRegistrationFlushRetry()
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
    invalidateRegistrationDeliveryState()
    return false
  }

  // Persist even while consent is unknown. Flush waits for grant + Amplitude init
  // + user identity, so a later full-page redirect still has the marker.
  return storeRegistrationIntent(createRegistrationIntent(method, utmInfo))
}

export const coordinateRegistrationConsent = (consent: AnalyticsConsent) => {
  if (consent === 'denied' || consent === 'disabled') invalidateRegistrationDeliveryState()
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

const runRegistrationFlush = async (generation: number) => {
  const isStale = () => generation !== getRegistrationDeliveryGeneration()
  if (isStale()) return

  const consent = getAnalyticsConsent()
  if (consent === 'unknown') return

  const storage = getRegistrationSessionStorage()
  if (!storage) return

  if (consent === 'denied' || consent === 'disabled') {
    invalidateRegistrationDeliveryState()
    return
  }
  if (!getIsAmplitudeInitialized()) return

  while (true) {
    if (isStale()) return

    let raw: string | null
    try {
      raw = storage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    } catch {
      return
    }
    if (!raw) return

    const pending = parsePendingRegistration(raw)
    const now = Date.now()
    if (
      !pending ||
      pending.expiresAt <= now ||
      pending.occurredAt > now + REGISTRATION_FUTURE_CLOCK_SKEW_ALLOWANCE_MS
    ) {
      removeStoredRegistrationMarker(storage)
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

    let acknowledged = false
    try {
      const result: { code?: unknown } = await trackResult.promise
      acknowledged =
        typeof result.code === 'number' &&
        result.code >= SUCCESSFUL_TRACK_RESULT_MIN &&
        result.code <= SUCCESSFUL_TRACK_RESULT_MAX
    } catch {}
    if (isStale()) return

    let currentRaw: string | null
    try {
      currentRaw = storage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    } catch {
      return
    }
    if (currentRaw !== raw) continue
    if (!acknowledged) {
      scheduleRegistrationFlushRetry(() => {
        void flushRegistrationSuccess()
      })
      return
    }

    clearRegistrationFlushRetry()
    removeStoredRegistrationMarker(storage)
    return
  }
}

export function flushRegistrationSuccess() {
  const generation = getRegistrationDeliveryGeneration()
  if (activeFlush?.generation === generation) return activeFlush.promise

  const promise = runRegistrationFlush(generation).finally(() => {
    if (activeFlush?.promise === promise) activeFlush = null
  })
  activeFlush = { generation, promise }
  return promise
}
