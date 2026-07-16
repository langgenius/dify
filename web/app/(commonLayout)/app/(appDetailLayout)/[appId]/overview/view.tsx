'use client'

import { useAtomValue } from 'jotai'
import * as React from 'react'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'
import { useStore as useAppStore } from '@/app/components/app/store'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { getAppACLCapabilities } from '@/utils/permission'
import ChartView from './chart-view'
import TracingPanel from './tracing/panel'

type OverviewViewProps = {
  appId: string
}

const OverviewView = ({ appId }: OverviewViewProps) => {
  const appDetail = useAppStore((state) => state.appDetail)
  const currentUserId = useAtomValue(userProfileIdAtom)
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
