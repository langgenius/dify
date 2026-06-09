import type { ReactNode } from 'react'
import { DeployDrawer } from '@/features/deployments/components/deploy-drawer'

export default function DeploymentsLayout({ children }: {
  children: ReactNode
}) {
  return (
    <>
      {children}
      <DeployDrawer />
    </>
  )
}
