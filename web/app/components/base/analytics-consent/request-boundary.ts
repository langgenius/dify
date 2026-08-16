import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

const EXCLUDED_ANALYTICS_PATH_SEGMENTS = [
  '/agent',
  '/chat',
  '/chatbot',
  '/completion',
  '/workflow',
  '/webapp-reset-password',
  '/webapp-signin',
] as const

type CloudAnalyticsRequest = {
  cookieYesSiteKey: string | undefined
  deploymentEdition: DeploymentEdition
  isProd: boolean
  pathname: string
  requestHost: string | null
  webPrefix: string | undefined
}

export function isCloudAnalyticsPath(pathname: string) {
  return !EXCLUDED_ANALYTICS_PATH_SEGMENTS.some(
    (segment) => pathname === segment || pathname.startsWith(`${segment}/`),
  )
}

export function isCloudAnalyticsRequest({
  cookieYesSiteKey,
  deploymentEdition,
  isProd,
  pathname,
  requestHost,
  webPrefix,
}: CloudAnalyticsRequest) {
  if (
    deploymentEdition !== 'CLOUD' ||
    !isProd ||
    !cookieYesSiteKey?.trim() ||
    !requestHost ||
    !webPrefix
  )
    return false
  if (!isCloudAnalyticsPath(pathname)) return false

  try {
    const expectedHost = new URL(webPrefix).host.toLowerCase()
    const currentHost = requestHost.split(',')[0]?.trim().toLowerCase()
    return currentHost === expectedHost
  } catch {
    return false
  }
}
