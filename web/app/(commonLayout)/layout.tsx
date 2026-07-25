import * as React from 'react'
import Zendesk from '@/app/components/base/zendesk'
import { getInitialDetailSidebarMode } from '@/app/components/detail-sidebar/server'
import { DetailSidebarStateInitializer } from '@/app/components/detail-sidebar/state-initializer'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import MainNavLayout from '@/app/components/main-nav/layout'
import { NextRouteStateBridge } from '@/app/components/next-route-state'
import { CommonLayoutGlobalMounts } from './global-mounts'
import { ConsoleContextProviders, ConsoleRuntimeProviders } from './providers'

export default async function Layout({
  children,
  detailSidebar,
}: {
  children: React.ReactNode
  detailSidebar: React.ReactNode
}) {
  const initialDetailSidebarMode = await getInitialDetailSidebarMode()

  return (
    <React.Fragment>
      <DetailSidebarStateInitializer initialMode={initialDetailSidebarMode}>
        <ConsoleRuntimeProviders>
          <NextRouteStateBridge>
            <div className="flex h-full flex-col overflow-hidden">
              <MaintenanceNotice />
              <ConsoleContextProviders>
                <MainNavLayout detailSidebar={detailSidebar}>{children}</MainNavLayout>
                <CommonLayoutGlobalMounts />
              </ConsoleContextProviders>
            </div>
          </NextRouteStateBridge>
        </ConsoleRuntimeProviders>
      </DetailSidebarStateInitializer>
      <Zendesk />
    </React.Fragment>
  )
}
