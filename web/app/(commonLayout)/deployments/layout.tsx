import type { ReactNode } from 'react'
import { DeployDrawer } from '@/features/deployments/deploy-drawer'
import {
  getSystemFeaturesQueryClient,
  systemFeaturesServerQueryOptions,
} from '@/features/system-features/server'
import { notFound } from '@/next/navigation'

export default async function DeploymentsLayout({ children }: { children: ReactNode }) {
  const systemFeatures = await getSystemFeaturesQueryClient().ensureQueryData(
    systemFeaturesServerQueryOptions(),
  )

  if (!systemFeatures.enable_app_deploy) notFound()

  return (
    <>
      {children}
      <DeployDrawer />
    </>
  )
}
