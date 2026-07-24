import { COOKIEYES_SITE_KEY, IS_PROD, WEB_PREFIX } from '@/config'
import { getQueryClientServer } from '@/context/query-client-server'
import { serverSystemFeaturesQueryOptions } from '@/features/system-features/server'
import { headers } from '@/next/headers'
import Script from '@/next/script'
import { GoogleAnalyticsTagScripts, GoogleConsentDefaults } from '../ga'
import { CloudAnalyticsRuntime } from './cloud-analytics-runtime'
import { isCloudAnalyticsRequest } from './request-boundary'

const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'

export async function CloudAnalytics() {
  const queryClient = getQueryClientServer()
  const systemFeaturesQuery = serverSystemFeaturesQueryOptions()
  const systemFeatures = queryClient.getQueryData(systemFeaturesQuery.queryKey)

  if (!systemFeatures) return null

  const requestHeaders = await headers()
  const pathname = requestHeaders.get(CURRENT_PATHNAME_HEADER) || '/'
  const requestHost = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host')
  const enabled = isCloudAnalyticsRequest({
    cookieYesSiteKey: COOKIEYES_SITE_KEY,
    deploymentEdition: systemFeatures.deployment_edition,
    isProd: IS_PROD,
    pathname,
    requestHost,
    webPrefix: WEB_PREFIX,
  })

  if (!enabled) return null

  const nonce = requestHeaders.get('x-nonce') ?? undefined
  const cookieYesScriptSrc = `https://cdn-cookieyes.com/client_data/${COOKIEYES_SITE_KEY}/script.js`

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
      <CloudAnalyticsRuntime />
    </>
  )
}
