import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { headers } from '@/next/headers'
import { CloudAnalyticsBoundary } from './cloud-analytics-boundary'
import { CloudAnalyticsRuntime } from './cloud-analytics-runtime'
import { getCloudAnalyticsState } from './cloud-analytics-state'

export async function CloudAnalytics({
  deploymentEdition,
}: {
  deploymentEdition: DeploymentEdition
}) {
  const requestHeaders = await headers()
  const { cookieYesSiteKey, enabled, nonce } = getCloudAnalyticsState(
    requestHeaders,
    deploymentEdition,
  )

  if (!enabled) return null

  return (
    <>
      <CloudAnalyticsBoundary cookieYesSiteKey={cookieYesSiteKey} nonce={nonce} />
      <CloudAnalyticsRuntime />
    </>
  )
}
