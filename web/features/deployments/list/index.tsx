'use client'

import { ScopeProvider } from 'jotai-scope'
import { useQueryState } from 'nuqs'
import {
  deploymentsListEnvironmentIdAtom,
  deploymentsListKeywordsAtom,
  envFilterQueryState,
  keywordsQueryState,
} from './state'
import { DeploymentsListShell } from './ui/shell'

export function DeploymentsList() {
  const [envFilter] = useQueryState('env', envFilterQueryState)
  const [keywords] = useQueryState('keywords', keywordsQueryState)
  const stateKey = `${envFilter ?? 'all'}:${keywords}`

  return (
    <ScopeProvider
      key={stateKey}
      atoms={[
        [deploymentsListEnvironmentIdAtom, envFilter],
        [deploymentsListKeywordsAtom, keywords],
      ]}
      name="DeploymentsList"
    >
      <DeploymentsListShell />
    </ScopeProvider>
  )
}
