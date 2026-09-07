import * as React from 'react'
import Zendesk from '@/app/components/base/zendesk'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import MainNavLayout from '@/app/components/main-nav/layout'
import { CommonLayoutGlobalMounts } from './global-mounts'
import { ConsoleContextProviders, ConsoleRuntimeProviders } from './providers'

export default async function Layout({
  children,
  detailSidebar,
}: {
  children: React.ReactNode
  detailSidebar: React.ReactNode
}) {
  return (
    <React.Fragment>
      <ConsoleRuntimeProviders>
        <div className="flex h-full flex-col overflow-hidden">
          <MaintenanceNotice />
          <ConsoleContextProviders>
            <MainNavLayout detailSidebar={detailSidebar}>{children}</MainNavLayout>
            <CommonLayoutGlobalMounts />
          </ConsoleContextProviders>
        </div>
      </ConsoleRuntimeProviders>
      <Zendesk />
    </React.Fragment>
  )
}
