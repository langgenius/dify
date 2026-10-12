'use client'

import { useSuspenseQueries } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { getAppACLCapabilities } from '@/utils/permission'
import ChartView from './chart-view'
import TracingPanel from './tracing/panel'

type OverviewViewProps = {
  appId: string
}

const OverviewView = ({ appId }: OverviewViewProps) => {
  const [{ data: appDetail }, { data: userProfile }] = useSuspenseQueries({
    queries: [
      consoleQuery.apps.byAppId.get.queryOptions({
        input: { params: { app_id: appId } },
      }),
      userProfileQueryOptions(),
    ],
  })
  const currentUserId = userProfile.profile.id
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = React.useMemo(
    () =>
      getAppACLCapabilities(appDetail.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys],
  )

  if (!appACLCapabilities.canMonitor) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ApikeyInfoPanel />
      <div className="min-h-0 flex-1">
        <ChartView
          appId={appId}
          appMode={appDetail.mode}
          headerRight={
            appACLCapabilities.canConfigureTracing ? (
              <TracingPanel appId={appId} readOnly={false} />
            ) : null
          }
        />
      </div>
    </div>
  )
}

export default OverviewView
