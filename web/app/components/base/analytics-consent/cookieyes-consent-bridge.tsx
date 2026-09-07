'use client'

import { useEffect } from 'react'
import {
  getAnalyticsConsentFromCookie,
  getAnalyticsConsentFromEvent,
  setAnalyticsConsent,
} from './consent-store'

export const COOKIEYES_CONSENT_UPDATE_EVENT = 'cookieyes_consent_update'

export function CookieYesConsentBridge() {
  useEffect(() => {
    setAnalyticsConsent(getAnalyticsConsentFromCookie(document.cookie))

    const handleConsentUpdate = (event: Event) => {
      if (!(event instanceof CustomEvent)) return

      const nextConsent = getAnalyticsConsentFromEvent(event.detail)
      if (nextConsent) setAnalyticsConsent(nextConsent)
    }

    document.addEventListener(COOKIEYES_CONSENT_UPDATE_EVENT, handleConsentUpdate)
    return () => {
      document.removeEventListener(COOKIEYES_CONSENT_UPDATE_EVENT, handleConsentUpdate)
    }
  }, [])

  return null
}
