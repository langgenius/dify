'use client'

import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'
import { ReleaseHistoryTable } from './release-history/release-history-table'
import { releasesLocalAtoms } from './state'

export function DeploymentReleases() {
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)

  return (
    <ScopeProvider key={appInstanceId} atoms={releasesLocalAtoms} name="DeploymentReleases">
      <div className="flex w-full min-w-0 flex-col gap-4 px-6 py-6">
        <ReleaseHistoryTable />
      </div>
    </ScopeProvider>
  )
}
