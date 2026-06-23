import type { ReactNode } from 'react'
import { DeployDrawer } from '@/features/deployments/deploy-drawer'
import { DeploymentsRouteStateHydrator } from '@/features/deployments/route-state-hydrator'

export default function DeploymentsLayout({ children }: {
  children: ReactNode
}) {
  return (
    <>
      <DeploymentsRouteStateHydrator />
      {children}
      <DeployDrawer />
    </>
  )
}
