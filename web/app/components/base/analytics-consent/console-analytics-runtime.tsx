'use client'

import AmplitudeProvider from '@/app/components/base/amplitude'
import ExternalAttributionRecorder from '@/app/components/external-attribution-recorder'
import { CookieYesConsentBridge } from './cookieyes-consent-bridge'

export function ConsoleAnalyticsRuntime() {
  return (
    <>
      <CookieYesConsentBridge />
      <AmplitudeProvider />
      <ExternalAttributionRecorder />
    </>
  )
}
