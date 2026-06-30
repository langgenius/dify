'use client'

import * as React from 'react'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { getAppACLCapabilities } from '@/utils/permission'
import ChartView from './chart-view'
import TracingPanel from './tracing/panel'

type OverviewViewProps = {
  appId: string
}

const OverviewView = ({ appId }: OverviewViewProps) => {
  const appDetail = useAppStore(state => state.appDetail)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const appACLCapabilities = React.useMemo(() => getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }), [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys])

  if (!appDetail || !appACLCapabilities.canMonitor)
    return null

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
