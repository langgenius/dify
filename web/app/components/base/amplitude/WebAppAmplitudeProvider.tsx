'use client'

import { useEffect } from 'react'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import {
  ensureWebAppAmplitudeInitialized,
  sendWebAppAmplitudeEvent,
  setWebAppAmplitudeOptOut,
} from './web-app-client'
import { registerWebAppEventTracker } from './web-app-event'

export function WebAppAmplitudeProvider() {
  const consent = useAnalyticsConsent()

  useEffect(() => {
    if (consent !== 'granted') {
      setWebAppAmplitudeOptOut(true)
      return
    }

    setWebAppAmplitudeOptOut(false)
    const unregisterTracker = registerWebAppEventTracker(sendWebAppAmplitudeEvent)
    void ensureWebAppAmplitudeInitialized()

    return () => {
      unregisterTracker()
      setWebAppAmplitudeOptOut(true)
    }
  }, [consent])

  return null
}
