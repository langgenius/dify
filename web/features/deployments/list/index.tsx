'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { useQueryState } from 'nuqs'
import { deploymentActionsLocalAtoms } from '../components/deployment-actions/state'
import {
  deploymentsListEnvironmentIdAtom,
  deploymentsListKeywordsAtom,
  envFilterQueryState,
  keywordsQueryState,
} from './state'
import { DeploymentsListShell } from './ui/shell'

function DeploymentsListStateBoundary({ children }: {
  children: ReactNode
}) {
  const [envFilter] = useQueryState('env', envFilterQueryState)
  const [keywords] = useQueryState('keywords', keywordsQueryState)
  const stateKey = `${envFilter ?? 'all'}:${keywords}`

  return (
    <ScopeProvider
      key={stateKey}
      atoms={[
        [deploymentsListEnvironmentIdAtom, envFilter],
        [deploymentsListKeywordsAtom, keywords],
        ...deploymentActionsLocalAtoms,
      ]}
      name="DeploymentsList"
    >
      {children}
    </ScopeProvider>
  )
}

export function DeploymentsList() {
  return (
    <DeploymentsListStateBoundary>
      <DeploymentsListShell />
    </DeploymentsListStateBoundary>
  )
}
