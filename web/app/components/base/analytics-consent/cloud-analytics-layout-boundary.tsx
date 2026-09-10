'use client'

import { useSelectedLayoutSegments } from '@/next/navigation'
import Script from '@/next/script'
import { GoogleAnalyticsTagScripts, GoogleConsentDefaults } from '../ga'
import { ConsoleAnalyticsRuntime } from './console-analytics-runtime'
import { WebAppAnalyticsRuntime } from './web-app-analytics-runtime'

const SHARE_LAYOUT_SEGMENT = '(shareLayout)'

type CloudAnalyticsLayoutBoundaryProps = {
  cookieYesSiteKey: string
  nonce?: string
}

export function CloudAnalyticsLayoutBoundary({
  cookieYesSiteKey,
  nonce,
}: CloudAnalyticsLayoutBoundaryProps) {
  const layoutSegments = useSelectedLayoutSegments()
  const cookieYesScript = (
    <Script
      id="cookieyes"
      strategy="beforeInteractive"
      type="text/javascript"
      src={`https://cdn-cookieyes.com/client_data/${cookieYesSiteKey}/script.js`}
      nonce={nonce}
    />
  )

  if (layoutSegments.includes(SHARE_LAYOUT_SEGMENT)) {
    return (
      <>
        {cookieYesScript}
        <WebAppAnalyticsRuntime />
      </>
    )
  }

  return (
    <>
      <GoogleConsentDefaults nonce={nonce} />
      {cookieYesScript}
      <GoogleAnalyticsTagScripts nonce={nonce} />
      <ConsoleAnalyticsRuntime />
    </>
  )
}
