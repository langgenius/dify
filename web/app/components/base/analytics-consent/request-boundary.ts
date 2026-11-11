import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

type CloudAnalyticsRequest = {
  cookieYesSiteKey: string | undefined
  deploymentEdition: DeploymentEdition
  isProd: boolean
  requestHost: string | null
  webPrefix: string | undefined
}

export function isCloudAnalyticsRequest({
  cookieYesSiteKey,
  deploymentEdition,
  isProd,
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

  try {
    const expectedHost = new URL(webPrefix).host.toLowerCase()
    const currentHost = requestHost.split(',')[0]?.trim().toLowerCase()
    return currentHost === expectedHost
  } catch {
    return false
  }
}
