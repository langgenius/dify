'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'
import { useStore as useAppStore } from '@/app/components/app/store'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getAppACLCapabilities } from '@/utils/permission'
import ChartView from './chart-view'
import TracingPanel from './tracing/panel'

type OverviewViewProps = {
  appId: string
}

const OverviewView = ({ appId }: OverviewViewProps) => {
  const appDetail = useAppStore((state) => state.appDetail)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = React.useMemo(
    () =>
      getAppACLCapabilities(appDetail?.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail?.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys],
  )

  if (!appDetail || !appACLCapabilities.canMonitor) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ApikeyInfoPanel />
      <div className="min-h-0 flex-1">
        <ChartView
          appId={appId}
          headerRight={appACLCapabilities.canConfigureTracing ? <TracingPanel /> : null}
        />
      </div>
    </div>
  )
}

export default OverviewView
