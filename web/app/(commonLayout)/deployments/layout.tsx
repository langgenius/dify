import type { ReactNode } from 'react'
import { getQueryClientServer } from '@/context/query-client-server'
import { DeployDrawer } from '@/features/deployments/deploy-drawer'
import { notFound } from '@/next/navigation'
import { serverConsoleQuery } from '@/service/server'

export default async function DeploymentsLayout({ children }: { children: ReactNode }) {
  const systemFeatures = await getQueryClientServer().ensureQueryData(
    serverConsoleQuery.systemFeatures.get.queryOptions(),
  )

  if (!systemFeatures.enable_app_deploy) notFound()

  return (
    <>
      {children}
      <DeployDrawer />
    </>
  )
}
