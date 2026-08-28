import { COOKIEYES_SITE_KEY, IS_PROD, WEB_PREFIX } from '@/config'
import { getCachedSystemFeatures } from '@/features/system-features/server'
import { headers } from '@/next/headers'
import { CloudAnalyticsLayoutBoundary } from './cloud-analytics-layout-boundary'
import { isCloudAnalyticsRequest } from './request-boundary'

export async function CloudAnalytics() {
  const systemFeatures = getCachedSystemFeatures()

  if (!systemFeatures) return null

  const requestHeaders = await headers()
  const requestHost = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host')
  const enabled = isCloudAnalyticsRequest({
    cookieYesSiteKey: COOKIEYES_SITE_KEY,
    deploymentEdition: systemFeatures.deployment_edition,
    isProd: IS_PROD,
    requestHost,
    webPrefix: WEB_PREFIX,
  })

  if (!enabled) return null

  const nonce = requestHeaders.get('x-nonce') ?? undefined

  return <CloudAnalyticsLayoutBoundary cookieYesSiteKey={COOKIEYES_SITE_KEY} nonce={nonce} />
}
