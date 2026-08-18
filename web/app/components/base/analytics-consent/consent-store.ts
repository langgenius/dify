'use client'

import { useSyncExternalStore } from 'react'

export type AnalyticsConsent = 'unknown' | 'denied' | 'granted'

type CookieYesConsentUpdateDetail = {
  accepted: string[]
  rejected: string[]
}

const COOKIEYES_CONSENT_COOKIE_NAME = 'cookieyes-consent'

let analyticsConsent: AnalyticsConsent = 'unknown'
const listeners = new Set<() => void>()
const getServerAnalyticsConsent = (): AnalyticsConsent => 'unknown'

const isCookieYesConsentUpdateDetail = (
  detail: unknown,
): detail is CookieYesConsentUpdateDetail => {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false

  const candidate = detail as Partial<CookieYesConsentUpdateDetail>
  return Array.isArray(candidate.accepted) && Array.isArray(candidate.rejected)
}

export function getAnalyticsConsentFromCookie(cookieHeader: string): AnalyticsConsent {
  const cookiePrefix = `${COOKIEYES_CONSENT_COOKIE_NAME}=`
  const rawValue = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(cookiePrefix))
    ?.slice(cookiePrefix.length)

  if (!rawValue) return 'unknown'

  let decodedValue: string
  try {
    decodedValue = decodeURIComponent(rawValue)
  } catch {
    return 'unknown'
  }

  const analyticsEntry = decodedValue
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('analytics:'))

  if (analyticsEntry === 'analytics:yes') return 'granted'
  if (analyticsEntry === 'analytics:no') return 'denied'
  return 'unknown'
}

export function getAnalyticsConsentFromEvent(detail: unknown): AnalyticsConsent | null {
  if (!isCookieYesConsentUpdateDetail(detail)) return null
  if (detail.rejected.includes('analytics')) return 'denied'
  if (detail.accepted.includes('analytics')) return 'granted'
  return null
}

export function getAnalyticsConsent(): AnalyticsConsent {
  return analyticsConsent
}

export function setAnalyticsConsent(consent: AnalyticsConsent) {
  if (analyticsConsent === consent) return

  analyticsConsent = consent
  listeners.forEach((listener) => listener())
}

function subscribeAnalyticsConsent(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAnalyticsConsent() {
  return useSyncExternalStore(
    subscribeAnalyticsConsent,
    getAnalyticsConsent,
    getServerAnalyticsConsent,
  )
}
