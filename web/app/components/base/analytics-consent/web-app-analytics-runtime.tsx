'use client'

import { WebAppAmplitudeProvider } from '@/app/components/base/amplitude/WebAppAmplitudeProvider'
import { CookieYesConsentBridge } from './cookieyes-consent-bridge'

export function WebAppAnalyticsRuntime() {
  return (
    <>
      <CookieYesConsentBridge />
      <WebAppAmplitudeProvider />
    </>
  )
}
