'use client'

import AmplitudeProvider from '@/app/components/base/amplitude'
import { RegistrationConsentCoordinator } from '@/app/components/base/amplitude/registration-consent-coordinator'
import ExternalAttributionRecorder from '@/app/components/external-attribution-recorder'
import { CookieYesConsentBridge } from './cookieyes-consent-bridge'

export function ConsoleAnalyticsRuntime() {
  return (
    <>
      <CookieYesConsentBridge />
      <AmplitudeProvider />
      <RegistrationConsentCoordinator />
      <ExternalAttributionRecorder />
    </>
  )
}
