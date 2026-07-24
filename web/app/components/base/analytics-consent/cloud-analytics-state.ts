import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { COOKIEYES_SITE_KEY, IS_PROD, WEB_PREFIX } from '@/config'
import { isCloudAnalyticsRequest } from './request-boundary'

const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'

type RequestHeaders = {
  get: (name: string) => string | null
}

type CloudAnalyticsState = {
  cookieYesSiteKey: string
  enabled: boolean
  nonce?: string
}

export function getCloudAnalyticsState(
  requestHeaders: RequestHeaders,
  deploymentEdition: DeploymentEdition,
): CloudAnalyticsState {
  const pathname = requestHeaders.get(CURRENT_PATHNAME_HEADER) || '/'
  const requestHost = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host')
  const enabled = isCloudAnalyticsRequest({
    cookieYesSiteKey: COOKIEYES_SITE_KEY,
    isCloudEdition: deploymentEdition === 'CLOUD',
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
