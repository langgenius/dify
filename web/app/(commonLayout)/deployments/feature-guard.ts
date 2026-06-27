import { getQueryClientServer } from '@/context/query-client-server'
import { serverSystemFeaturesQueryOptions } from '@/features/system-features/server'
import { notFound } from '@/next/navigation'

export const guardDeploymentsRoute = async () => {
  const queryClient = getQueryClientServer()
  const systemFeatures = await queryClient.fetchQuery(serverSystemFeaturesQueryOptions())

  if (!systemFeatures.enable_app_deploy)
    notFound()
}
