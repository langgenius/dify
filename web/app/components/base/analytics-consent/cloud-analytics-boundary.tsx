import type { CloudAnalyticsBoundaryState } from './cloud-analytics-state'
import Script from '@/next/script'
import { GoogleAnalyticsTagScripts, GoogleConsentDefaults } from '../ga'

export function CloudAnalyticsBoundary({
  cookieYesSiteKey,
  enabled,
  nonce,
}: CloudAnalyticsBoundaryState) {
  if (!enabled) return null

  const cookieYesScriptSrc = `https://cdn-cookieyes.com/client_data/${cookieYesSiteKey}/script.js`

  return (
    <>
      <GoogleConsentDefaults nonce={nonce} />
      <Script
        id="cookieyes"
        strategy="beforeInteractive"
        type="text/javascript"
        src={cookieYesScriptSrc}
        nonce={nonce}
      />
      <GoogleAnalyticsTagScripts nonce={nonce} />
    </>
  )
}
