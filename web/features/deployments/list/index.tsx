'use client'

import { DeploymentsListStateBoundary } from './state'
import { DeploymentsListShell } from './ui/shell'

export function DeploymentsList() {
  return (
    <DeploymentsListStateBoundary>
      <DeploymentsListShell />
    </DeploymentsListStateBoundary>
  )
}
