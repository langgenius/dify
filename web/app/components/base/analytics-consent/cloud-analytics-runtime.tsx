'use client'

import AmplitudeProvider from '@/app/components/base/amplitude'
import { usePathname } from '@/next/navigation'
import { CookieYesConsentBridge } from './cookieyes-consent-bridge'
import { isCloudAnalyticsPath } from './request-boundary'

export function CloudAnalyticsRuntime() {
  const pathname = usePathname()

  return (
    <>
      <CookieYesConsentBridge />
      <AmplitudeProvider active={isCloudAnalyticsPath(pathname)} />
    </>
  )
}
