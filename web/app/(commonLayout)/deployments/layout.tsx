import type { ReactNode } from 'react'
import { DeployDrawer } from '@/features/deployments/deploy-drawer'
import { guardDeploymentsRoute } from './feature-guard'

export default async function DeploymentsLayout({ children }: {
  children: ReactNode
}) {
  await guardDeploymentsRoute()

  return (
    <>
      {children}
      <DeployDrawer />
    </>
  )
}
