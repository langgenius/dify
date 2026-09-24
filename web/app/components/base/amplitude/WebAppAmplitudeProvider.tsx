'use client'

import { useEffect } from 'react'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { sendWebAppAmplitudeEvent, setWebAppAmplitudeOptOut } from './web-app-client'
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

    return () => {
      unregisterTracker()
      setWebAppAmplitudeOptOut(true)
    }
  }, [consent])

  return null
}
