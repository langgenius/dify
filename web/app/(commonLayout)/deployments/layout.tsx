import type { ReactNode } from 'react'
import { getQueryClientServer } from '@/context/query-client-server'
import { DeployDrawer } from '@/features/deployments/deploy-drawer'
import { serverSystemFeaturesQueryOptions } from '@/features/system-features/server'
import { notFound } from '@/next/navigation'

export default async function DeploymentsLayout({ children }: { children: ReactNode }) {
  const systemFeatures = await getQueryClientServer().ensureQueryData(
    serverSystemFeaturesQueryOptions(),
  )

  if (!systemFeatures.enable_app_deploy) notFound()

  return (
    <>
      {children}
      <DeployDrawer />
    </>
  )
}
