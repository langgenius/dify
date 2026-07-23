import { COOKIEYES_SITE_KEY, IS_CLOUD_EDITION, IS_PROD, WEB_PREFIX } from '@/config'
import { isCloudAnalyticsRequest } from './request-boundary'

const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'

type RequestHeaders = {
  get: (name: string) => string | null
}

export type CloudAnalyticsBoundaryState = {
  cookieYesSiteKey: string
  enabled: boolean
  nonce?: string
}

export function getCloudAnalyticsBoundaryState(
  requestHeaders: RequestHeaders,
): CloudAnalyticsBoundaryState {
  const pathname = requestHeaders.get(CURRENT_PATHNAME_HEADER) || '/'
  const requestHost = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host')
  const enabled = isCloudAnalyticsRequest({
    cookieYesSiteKey: COOKIEYES_SITE_KEY,
    isCloudEdition: IS_CLOUD_EDITION,
    isProd: IS_PROD,
    pathname,
    requestHost,
    webPrefix: WEB_PREFIX,
  })

  return {
    cookieYesSiteKey: COOKIEYES_SITE_KEY,
    enabled,
    nonce: requestHeaders.get('x-nonce') ?? undefined,
  }
}
